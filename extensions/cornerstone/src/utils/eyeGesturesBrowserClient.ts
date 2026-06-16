type EyeGesturesStatus = 'connected' | 'disconnected' | 'waiting' | 'calibrating';

type EyeGesturesBrowserClientOptions = {
  scriptUrl?: string;
  stylesheetUrl?: string;
};

type EyeGesturesConstructor = new (
  videoElementId: string,
  onGaze: (point: [number, number], calibration?: boolean) => void
) => {
  invisible?: () => void;
  showCalibrationInstructions?: (onRead: () => void) => void;
  start: () => void;
  stop?: () => void;
  recalibrate?: () => void;
};

declare global {
  interface Window {
    EyeGestures?: EyeGesturesConstructor;
    OHIFEyeGesturesClient?: {
      connect: () => void;
      disconnect: () => void;
      getStatus: () => EyeGesturesStatus;
      getMessage: () => string | undefined;
      getUrl: () => string;
      recalibrate?: () => void;
      setCalibrationUiVisible?: (visible: boolean) => void;
    };
  }
}

function getGazeCaptureBridge() {
  return (window as any).OHIFGazeCaptureBridge;
}

const DEFAULT_SCRIPT_URL = 'https://eyegestures.com/eyegestures.js';
const DEFAULT_STYLESHEET_URL = 'https://eyegestures.com/eyegestures.css';
const STORAGE_SCRIPT_URL_KEY = 'ohif.eyeGestures.browserScriptUrl';
const STORAGE_ENABLED_KEY = 'ohif.eyeGestures.enabled';
const STATUS_EVENT = 'ohif-eyegestures-status';
const VIDEO_ID = 'video';
const STATUS_ID = 'status';
const ERROR_ID = 'error';
// The moving calibration target EyeGestures renders. Its left/top are updated
// every frame to the active calibration point, so reading it tells the gate
// which of the calibration circles is currently being shown.
const CALIB_CURSOR_ID = 'calib_cursor';
// The calibration cues we reveal so the user can follow the real target. The
// EyeGestures logo is intentionally excluded so it stays hidden at all times.
const EYE_GESTURES_CALIBRATION_UI_IDS = ['calibrationOverlay', 'cursor', 'calib_cursor'];
const EYE_GESTURES_ALWAYS_HIDDEN_IDS = ['logoDivEyeGestures'];

let installed = false;
let connecting = false;
let status: EyeGesturesStatus = 'disconnected';
let lastMessage: string | undefined;
let currentScriptUrl = DEFAULT_SCRIPT_URL;
let currentStylesheetUrl = DEFAULT_STYLESHEET_URL;
let gestures: InstanceType<EyeGesturesConstructor> | null = null;
let cleanupUiSuppressor: (() => void) | null = null;
// When true, EyeGestures' own calibration UI (the red dot / overlay) is allowed
// to show so the user can follow the real target that drives sampling.
let calibrationUiVisible = false;

function getEyeGesturesConstructor(): EyeGesturesConstructor | undefined {
  if (window.EyeGestures) {
    return window.EyeGestures;
  }

  try {
    return (0, eval)('EyeGestures') as EyeGesturesConstructor;
  } catch {
    return undefined;
  }
}

function dispatchStatus(nextStatus: EyeGesturesStatus, message?: string) {
  status = nextStatus;
  lastMessage = message;
  window.dispatchEvent(
    new CustomEvent(STATUS_EVENT, {
      detail: {
        status: nextStatus,
        message,
        url: currentScriptUrl,
      },
    })
  );
}

function getConfiguredScriptUrl(options?: EyeGesturesBrowserClientOptions) {
  try {
    return (
      options?.scriptUrl ||
      window.localStorage.getItem(STORAGE_SCRIPT_URL_KEY) ||
      DEFAULT_SCRIPT_URL
    );
  } catch {
    return options?.scriptUrl || DEFAULT_SCRIPT_URL;
  }
}

function isDisabled() {
  try {
    return window.localStorage.getItem(STORAGE_ENABLED_KEY) === 'false';
  } catch {
    return false;
  }
}

function ensureElement<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tagName: K
): HTMLElementTagNameMap[K] {
  const existing = document.getElementById(id);
  if (existing) {
    return existing as HTMLElementTagNameMap[K];
  }

  const element = document.createElement(tagName);
  element.id = id;
  element.style.display = 'none';
  document.body.appendChild(element);

  return element;
}

function ensureEyeGesturesDom() {
  const video = ensureElement(VIDEO_ID, 'video');
  video.setAttribute('autoplay', 'true');
  video.setAttribute('playsinline', 'true');
  video.style.display = 'none';

  ensureElement(STATUS_ID, 'div');
  ensureElement(ERROR_ID, 'div');
}

function hideElementsById(ids: string[]) {
  ids.forEach(id => {
    const element = document.getElementById(id);

    if (!element) {
      return;
    }

    element.style.display = 'none';
    element.style.pointerEvents = 'none';
  });
}

function hideEyeGesturesUi() {
  // The EyeGestures logo is always hidden, even during calibration.
  hideElementsById(EYE_GESTURES_ALWAYS_HIDDEN_IDS);

  // While calibrating with visible cues, leave EyeGestures' own target dot /
  // overlay alone so the user can follow the real target.
  if (calibrationUiVisible) {
    return;
  }

  hideElementsById(EYE_GESTURES_CALIBRATION_UI_IDS);
}

function setCalibrationUiVisible(visible: boolean) {
  calibrationUiVisible = visible;

  if (visible) {
    // Reveal the calibration cues EyeGestures created and lift them above our
    // calibration overlay (z-index 1000) so the target dot shows. The logo
    // stays hidden.
    EYE_GESTURES_CALIBRATION_UI_IDS.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.style.removeProperty('display');
        element.style.removeProperty('pointer-events');
        element.style.zIndex = '1001';
      }
    });
    hideElementsById(EYE_GESTURES_ALWAYS_HIDDEN_IDS);
  } else {
    hideEyeGesturesUi();
  }
}

function installEyeGesturesUiSuppressor() {
  hideEyeGesturesUi();

  const observer = new MutationObserver(hideEyeGesturesUi);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  return () => observer.disconnect();
}

function loadScript(url: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-ohif-eyegestures="true"]`
    );

    if (existing) {
      if (window.EyeGestures) {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), {
          once: true,
        });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.ohifEyegestures = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

function loadStylesheet(url: string) {
  if (!url || document.querySelector(`link[data-ohif-eyegestures-style="true"]`)) {
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.ohifEyegesturesStyle = 'true';
  document.head.appendChild(link);
}

// The library offsets calib_cursor's left/top by half its 200px size so the dot
// is centred on the target point. Undo that offset to recover the target centre.
const CALIB_CURSOR_HALF_SIZE = 100;

function getCalibrationTarget(): { tx: number; ty: number } | undefined {
  const cursor = document.getElementById(CALIB_CURSOR_ID);
  if (!cursor) {
    return undefined;
  }

  const left = parseFloat(cursor.style.left);
  const top = parseFloat(cursor.style.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return undefined;
  }

  return { tx: left + CALIB_CURSOR_HALF_SIZE, ty: top + CALIB_CURSOR_HALF_SIZE };
}

function handleGaze(point: [number, number], calibration?: boolean) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  const nextStatus = calibration ? 'calibrating' : 'connected';

  // Once real tracking starts, re-hide EyeGestures' calibration cues so they
  // don't linger over the study image.
  if (!calibration && calibrationUiVisible) {
    setCalibrationUiVisible(false);
  }

  dispatchStatus(
    nextStatus,
    calibration
      ? 'Calibrating — keep following the moving dot.'
      : 'Eye tracking active.'
  );

  // While calibrating, surface which target circle is currently shown so the
  // gate can require the user to follow every circle before completing.
  const target = calibration ? getCalibrationTarget() : undefined;

  // Emit every raw point regardless of whether a viewport is registered, so the
  // calibration gate can observe progress before gaze capture is enabled.
  window.dispatchEvent(
    new CustomEvent('ohif-eyegestures-gaze', {
      detail: {
        x,
        y,
        calibration: Boolean(calibration),
        targetX: target?.tx,
        targetY: target?.ty,
      },
    })
  );

  getGazeCaptureBridge()?.capture?.(x, y, Date.now(), {
    source: 'eyegestures-browser',
    calibration: Boolean(calibration),
  });
}

async function connect() {
  if (connecting || gestures || typeof window === 'undefined') {
    return;
  }

  if (isDisabled()) {
    dispatchStatus('disconnected', 'EyeGestures disabled by localStorage.');
    return;
  }

  if (!window.isSecureContext) {
    dispatchStatus('disconnected', 'EyeGestures requires HTTPS or localhost for webcam access.');
    return;
  }

  connecting = true;
  dispatchStatus('waiting', 'Loading EyeGesturesLite.');

  try {
    ensureEyeGesturesDom();
    loadStylesheet(currentStylesheetUrl);
    await loadScript(currentScriptUrl);

    const EyeGestures = getEyeGesturesConstructor();

    if (!EyeGestures) {
      throw new Error('EyeGesturesLite script loaded without exposing window.EyeGestures.');
    }

    dispatchStatus('waiting', 'Requesting webcam permission.');
    gestures = new EyeGestures(VIDEO_ID, handleGaze);
    // Note: we intentionally do NOT call gestures.invisible() — once EyeGestures
    // hides its cursor internally it cannot be brought back for a visible
    // recalibration. Instead our DOM suppressor (gated by calibrationUiVisible)
    // controls whether the cues are shown.
    gestures.showCalibrationInstructions = onRead => onRead();
    cleanupUiSuppressor = installEyeGesturesUiSuppressor();
    gestures.start();
    hideEyeGesturesUi();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dispatchStatus('disconnected', message);
    gestures = null;
  } finally {
    connecting = false;
  }
}

export function installEyeGesturesBrowserClient(options?: EyeGesturesBrowserClientOptions) {
  if (typeof window === 'undefined' || installed) {
    return;
  }

  currentScriptUrl = getConfiguredScriptUrl(options);
  currentStylesheetUrl = options?.stylesheetUrl || DEFAULT_STYLESHEET_URL;
  installed = true;

  window.OHIFEyeGesturesClient = {
    connect,
    disconnect: uninstallEyeGesturesBrowserClient,
    getStatus: () => status,
    getMessage: () => lastMessage,
    getUrl: () => currentScriptUrl,
    recalibrate: () => gestures?.recalibrate?.(),
    setCalibrationUiVisible,
  };

  connect();
}

export function uninstallEyeGesturesBrowserClient() {
  gestures?.stop?.();
  cleanupUiSuppressor?.();
  cleanupUiSuppressor = null;
  hideEyeGesturesUi();
  gestures = null;
  installed = false;
  connecting = false;
  dispatchStatus('disconnected', 'EyeGesturesLite stopped.');
}
