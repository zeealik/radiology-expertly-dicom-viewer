import {
  classifyPosition,
  computeConfidence,
  computeIpd,
  DEFAULT_THRESHOLDS,
  getFaceBox,
  getFaceCenter,
  matrixToEuler,
  STATUS_MESSAGES,
  UNKNOWN_STATE,
  type HeadBaseline,
  type HeadPose,
  type HeadStatus,
  type HeadTrackingState,
  type PositionSample,
} from './headTrackingMath';

export * from './headTrackingMath';

// ---------------------------------------------------------------------------
// Runtime (browser-only): own webcam stream + MediaPipe FaceLandmarker loop.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    OHIFHeadTracking?: {
      start: () => Promise<void>;
      stop: () => void;
      captureBaseline: () => boolean;
      getState: () => HeadTrackingState;
      setEnabled: (enabled: boolean) => void;
      getVideo: () => HTMLVideoElement | null;
    };
  }
}

const EVENT = 'ohif-head-tracking';
const VIDEO_ID = 'ohif-head-tracking-video';
const STORAGE_ENABLED_KEY = 'ohif.headTracking.enabled';
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const DETECT_INTERVAL_MS = 83; // ~12 fps
const EMIT_THROTTLE_MS = 100;
const BASELINE_FRAMES = 15;
const DEBOUNCE_MS = 500;
const SMOOTHING_ALPHA = 0.4;

let installed = false;
let starting = false;
let running = false;
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let faceLandmarker: any = null;
let lumaCanvas: HTMLCanvasElement | null = null;
let intervalId: number | null = null;
let lastEmit = 0;

let state: HeadTrackingState = { ...UNKNOWN_STATE };
let baseline: HeadBaseline | null = null;
let baselineSamples: PositionSample[] = [];
let collectingBaseline = false;

// smoothing + hysteresis
let smoothIpd = 0;
const smoothPose: HeadPose = { yaw: 0, pitch: 0, roll: 0 };
let committedStatus: HeadStatus = 'unknown';
let pendingStatus: HeadStatus | null = null;
let pendingSince = 0;

function isEnabled() {
  try {
    return window.localStorage.getItem(STORAGE_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

function emit(force = false) {
  const now = Date.now();
  if (!force && now - lastEmit < EMIT_THROTTLE_MS) {
    return;
  }
  lastEmit = now;
  window.dispatchEvent(new CustomEvent<HeadTrackingState>(EVENT, { detail: { ...state } }));
}

function setUnknown(message = '') {
  state = { ...UNKNOWN_STATE, message };
  committedStatus = 'unknown';
  pendingStatus = null;
  emit(true);
}

function ensureVideo(): HTMLVideoElement {
  let el = document.getElementById(VIDEO_ID) as HTMLVideoElement | null;
  if (!el) {
    el = document.createElement('video');
    el.id = VIDEO_ID;
    el.muted = true;
    el.setAttribute('playsinline', 'true');
    el.setAttribute('autoplay', 'true');
    el.style.position = 'fixed';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.left = '-9999px';
    document.body.appendChild(el);
  }
  return el;
}

function computeLuma(source: HTMLVideoElement): number {
  if (!lumaCanvas) {
    lumaCanvas = document.createElement('canvas');
    lumaCanvas.width = 32;
    lumaCanvas.height = 24;
  }
  const ctx = lumaCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !source.videoWidth) {
    return 255; // unknown lighting => don't false-trigger low-light
  }
  ctx.drawImage(source, 0, 0, lumaCanvas.width, lumaCanvas.height);
  const { data } = ctx.getImageData(0, 0, lumaCanvas.width, lumaCanvas.height);
  let sum = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / count;
}

function readSample(): PositionSample | null {
  if (!faceLandmarker || !video || !video.videoWidth) {
    return null;
  }

  let result: any;
  try {
    result = faceLandmarker.detectForVideo(video, performance.now());
  } catch {
    return null;
  }

  const landmarks = result?.faceLandmarks?.[0];
  const facePresent = Array.isArray(landmarks) && landmarks.length > 0;
  const luma = computeLuma(video);

  if (!facePresent) {
    return {
      facePresent: false,
      ipd: 0,
      center: { x: 0.5, y: 0.5 },
      faceBox: null,
      pose: { yaw: 0, pitch: 0, roll: 0 },
      luma,
    };
  }

  const aspect = video.videoWidth / video.videoHeight || 1;
  const ipd = computeIpd(landmarks, aspect);
  const center = getFaceCenter(landmarks);
  const faceBox = getFaceBox(landmarks);
  const matrix = result?.facialTransformationMatrixes?.[0]?.data;
  const pose = matrix ? matrixToEuler(matrix) : { yaw: 0, pitch: 0, roll: 0 };

  return { facePresent: true, ipd, center, faceBox, pose, luma };
}

function smooth(sample: PositionSample): PositionSample {
  if (smoothIpd === 0) {
    smoothIpd = sample.ipd;
    smoothPose.yaw = sample.pose.yaw;
    smoothPose.pitch = sample.pose.pitch;
    smoothPose.roll = sample.pose.roll;
  } else {
    smoothIpd = SMOOTHING_ALPHA * sample.ipd + (1 - SMOOTHING_ALPHA) * smoothIpd;
    smoothPose.yaw = SMOOTHING_ALPHA * sample.pose.yaw + (1 - SMOOTHING_ALPHA) * smoothPose.yaw;
    smoothPose.pitch =
      SMOOTHING_ALPHA * sample.pose.pitch + (1 - SMOOTHING_ALPHA) * smoothPose.pitch;
    smoothPose.roll = SMOOTHING_ALPHA * sample.pose.roll + (1 - SMOOTHING_ALPHA) * smoothPose.roll;
  }
  return { ...sample, ipd: smoothIpd, pose: { ...smoothPose } };
}

function finalizeBaseline() {
  collectingBaseline = false;
  if (!baselineSamples.length) {
    return;
  }
  const n = baselineSamples.length;
  const acc = baselineSamples.reduce(
    (a, s) => ({
      ipd: a.ipd + s.ipd,
      cx: a.cx + s.center.x,
      cy: a.cy + s.center.y,
      yaw: a.yaw + s.pose.yaw,
      pitch: a.pitch + s.pose.pitch,
      roll: a.roll + s.pose.roll,
    }),
    { ipd: 0, cx: 0, cy: 0, yaw: 0, pitch: 0, roll: 0 }
  );
  baseline = {
    ipd: acc.ipd / n,
    center: { x: acc.cx / n, y: acc.cy / n },
    pose: { yaw: acc.yaw / n, pitch: acc.pitch / n, roll: acc.roll / n },
  };
  baselineSamples = [];
  committedStatus = 'ok';
  pendingStatus = null;
  state = {
    ...state,
    status: 'ok',
    message: STATUS_MESSAGES.ok,
    warning: false,
    confidence: 1,
    offset: { x: 0, y: 0 },
    inSafeZone: true,
    direction: null,
  };
  emit(true);
}

function tick() {
  if (!running) {
    return;
  }

  const raw = readSample();
  if (!raw) {
    return;
  }

  if (collectingBaseline) {
    if (raw.facePresent && raw.luma >= DEFAULT_THRESHOLDS.lumaMin) {
      baselineSamples.push(raw);
      if (baselineSamples.length >= BASELINE_FRAMES) {
        finalizeBaseline();
      }
    }
    return;
  }

  const sample = raw.facePresent ? smooth(raw) : raw;

  if (!baseline) {
    // no baseline yet: report face presence but never pause capture
    state = {
      ...state,
      status: raw.facePresent ? 'ok' : 'face-lost',
      message: raw.facePresent ? '' : STATUS_MESSAGES['face-lost'],
      warning: !raw.facePresent,
      confidence: raw.facePresent ? 0.5 : 0,
      pose: sample.pose,
      ipd: sample.ipd,
      faceBox: sample.faceBox,
      inSafeZone: true,
      direction: raw.facePresent ? null : 'center',
    };
    emit();
    return;
  }

  const { status: candidate, direction } = classifyPosition(sample, baseline);

  // hysteresis: candidate must persist DEBOUNCE_MS before committing
  const now = Date.now();
  if (candidate !== committedStatus) {
    if (pendingStatus !== candidate) {
      pendingStatus = candidate;
      pendingSince = now;
    } else if (now - pendingSince >= DEBOUNCE_MS) {
      committedStatus = candidate;
      pendingStatus = null;
    }
  } else {
    pendingStatus = null;
  }

  const confidence = computeConfidence(sample, baseline);
  const warning = committedStatus !== 'ok' && committedStatus !== 'unknown';

  state = {
    status: committedStatus,
    message: STATUS_MESSAGES[committedStatus],
    warning,
    confidence,
    pose: sample.pose,
    ipd: sample.ipd,
    offset: {
      x: sample.center.x - baseline.center.x,
      y: sample.center.y - baseline.center.y,
    },
    faceBox: sample.faceBox,
    inSafeZone: committedStatus === 'ok',
    direction: committedStatus === 'ok' ? null : direction,
  };
  emit();
}

function startLoop() {
  if (intervalId === null) {
    intervalId = window.setInterval(tick, DETECT_INTERVAL_MS);
  }
}

function stopLoop() {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

function handleVisibility() {
  if (document.hidden) {
    stopLoop();
  } else if (running) {
    startLoop();
  }
}

async function loadFaceLandmarker() {
  if (faceLandmarker) {
    return;
  }
  const vision = await import('@mediapipe/tasks-vision');
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_CDN);
  faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,
  });
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (video) {
    video.srcObject = null;
  }
}

async function start(): Promise<void> {
  if (typeof window === 'undefined' || starting || running) {
    return;
  }
  if (!isEnabled()) {
    setUnknown('Head tracking disabled.');
    return;
  }

  starting = true;
  try {
    video = ensureVideo();
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    await loadFaceLandmarker();

    running = true;
    document.addEventListener('visibilitychange', handleVisibility);
    startLoop();
  } catch {
    // soft fail: never block the study if the camera or model is unavailable
    running = false;
    stopStream();
    setUnknown('');
  } finally {
    starting = false;
  }
}

function stop() {
  running = false;
  stopLoop();
  document.removeEventListener('visibilitychange', handleVisibility);
  stopStream();
  baseline = null;
  baselineSamples = [];
  smoothIpd = 0;
  setUnknown('');
}

function captureBaseline(): boolean {
  if (!running) {
    return false;
  }
  collectingBaseline = true;
  baselineSamples = [];
  return true;
}

export function installHeadTracking() {
  if (typeof window === 'undefined' || installed) {
    return;
  }
  installed = true;

  window.OHIFHeadTracking = {
    start,
    stop,
    captureBaseline,
    getState: () => ({ ...state }),
    setEnabled: (enabled: boolean) => {
      try {
        window.localStorage.setItem(STORAGE_ENABLED_KEY, enabled ? 'true' : 'false');
      } catch {
        // ignore
      }
      if (!enabled) {
        stop();
      }
    },
    getVideo: () => video,
  };
}

export function uninstallHeadTracking() {
  if (typeof window === 'undefined') {
    return;
  }
  stop();
  installed = false;
  delete window.OHIFHeadTracking;
}
