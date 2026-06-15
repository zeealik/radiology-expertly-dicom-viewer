export type HeadStatus =
  | 'ok'
  | 'too-close'
  | 'too-far'
  | 'shifted-left'
  | 'shifted-right'
  | 'shifted-up'
  | 'shifted-down'
  | 'head-turned'
  | 'face-lost'
  | 'low-light'
  | 'unknown';

export type HeadDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'forward'
  | 'back'
  | 'center'
  | null;

export type HeadPose = { yaw: number; pitch: number; roll: number }; // degrees

export type HeadTrackingState = {
  status: HeadStatus;
  message: string;
  warning: boolean;
  confidence: number; // 0..1
  pose: HeadPose;
  ipd: number; // normalized (eye-center distance / frame width)
  offset: { x: number; y: number }; // face-center offset from baseline, normalized
  faceBox: { x: number; y: number; w: number; h: number } | null;
  inSafeZone: boolean;
  direction: HeadDirection;
};

export type HeadBaseline = {
  ipd: number;
  center: { x: number; y: number };
  pose: HeadPose;
};

export type HeadThresholds = {
  ipdCloseRatio: number;
  ipdFarRatio: number;
  lateralPct: number;
  verticalPct: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  lumaMin: number;
};

export type PositionSample = {
  facePresent: boolean;
  ipd: number;
  center: { x: number; y: number };
  faceBox: { x: number; y: number; w: number; h: number } | null;
  pose: HeadPose;
  luma: number;
};

export type Landmark = { x: number; y: number; z?: number };

export const DEFAULT_THRESHOLDS: HeadThresholds = {
  ipdCloseRatio: 1.25,
  ipdFarRatio: 0.8,
  lateralPct: 0.12,
  verticalPct: 0.12,
  yawDeg: 20,
  pitchDeg: 18,
  rollDeg: 18,
  lumaMin: 40,
};

export const STATUS_MESSAGES: Record<HeadStatus, string> = {
  ok: '',
  unknown: '',
  'too-close': 'You are leaning too close to the screen.',
  'too-far': 'You are too far from the screen, please move closer.',
  'shifted-left': 'Your position changed. Move back to your original position.',
  'shifted-right': 'Your position changed. Move back to your original position.',
  'shifted-up': 'Your position changed. Move back to your original position.',
  'shifted-down': 'Your position changed. Move back to your original position.',
  'head-turned': 'Please keep your head straight and centered.',
  'face-lost': 'Your face is not detected, please return to view.',
  'low-light': 'Your environment is too dark for accurate tracking.',
};

export const UNKNOWN_STATE: HeadTrackingState = {
  status: 'unknown',
  message: '',
  warning: false,
  confidence: 0,
  pose: { yaw: 0, pitch: 0, roll: 0 },
  ipd: 0,
  offset: { x: 0, y: 0 },
  faceBox: null,
  inSafeZone: true, // soft-fail: never block capture when unknown
  direction: null,
};

// MediaPipe iris-center landmark indices (478-landmark model)
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
// eye-corner fallbacks
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const NOSE_TIP = 1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function radToDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

/**
 * Decompose a MediaPipe facial transformation matrix (16-element, column-major
 * 4x4) into Euler angles in degrees. Pure — unit tests pin the sign convention.
 */
export function matrixToEuler(m: Float32Array | number[]): HeadPose {
  // column-major: element [col*4 + row]
  // rotation entries: rIJ = row I, col J
  const r00 = m[0];
  const r10 = m[1];
  const r20 = m[2];
  const r21 = m[6];
  const r22 = m[10];

  // yaw: rotation about the vertical (Y) axis — left/right head turn
  const yaw = Math.atan2(-r20, Math.hypot(r21, r22));
  // pitch: rotation about the horizontal (X) axis — up/down nod
  const pitch = Math.atan2(r21, r22);
  // roll: rotation about the view (Z) axis — head tilt
  const roll = Math.atan2(r10, r00);

  return { yaw: radToDeg(yaw), pitch: radToDeg(pitch), roll: radToDeg(roll) };
}

function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Interpupillary distance as a fraction of frame width. Larger ⇒ closer to the
 * screen. Uses iris centers when present, else eye-corner midpoints. y is
 * normalized by aspect so the distance is expressed in x-units.
 */
export function computeIpd(landmarks: Landmark[], frameAspect: number): number {
  if (!landmarks || landmarks.length === 0) {
    return 0;
  }

  const left = landmarks[LEFT_IRIS] ?? midpoint(landmarks[LEFT_EYE_OUTER], landmarks[LEFT_EYE_INNER]);
  const right =
    landmarks[RIGHT_IRIS] ?? midpoint(landmarks[RIGHT_EYE_INNER], landmarks[RIGHT_EYE_OUTER]);

  if (!left || !right) {
    return 0;
  }

  const dx = right.x - left.x;
  const dy = (right.y - left.y) / (frameAspect || 1);

  return Math.hypot(dx, dy);
}

export function getFaceCenter(landmarks: Landmark[]): { x: number; y: number } {
  const nose = landmarks?.[NOSE_TIP];
  return nose ? { x: nose.x, y: nose.y } : { x: 0.5, y: 0.5 };
}

export function getFaceBox(landmarks: Landmark[]): { x: number; y: number; w: number; h: number } | null {
  if (!landmarks?.length) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const landmark of landmarks) {
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
      continue;
    }

    minX = Math.min(minX, landmark.x);
    minY = Math.min(minY, landmark.y);
    maxX = Math.max(maxX, landmark.x);
    maxY = Math.max(maxY, landmark.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    x: clamp(minX, 0, 1),
    y: clamp(minY, 0, 1),
    w: clamp(maxX - minX, 0, 1),
    h: clamp(maxY - minY, 0, 1),
  };
}

/**
 * Classify the current head sample against the calibration baseline. Returns a
 * single primary status (priority ordered) and the direction the user should
 * move to return to position.
 */
export function classifyPosition(
  sample: PositionSample,
  baseline: HeadBaseline,
  thresholds: HeadThresholds = DEFAULT_THRESHOLDS
): { status: HeadStatus; direction: HeadDirection } {
  if (!sample.facePresent) {
    return { status: 'face-lost', direction: 'center' };
  }

  if (sample.luma < thresholds.lumaMin) {
    return { status: 'low-light', direction: null };
  }

  const baseIpd = baseline.ipd || sample.ipd || 1;

  if (sample.ipd > baseIpd * thresholds.ipdCloseRatio) {
    return { status: 'too-close', direction: 'back' };
  }

  if (sample.ipd < baseIpd * thresholds.ipdFarRatio) {
    return { status: 'too-far', direction: 'forward' };
  }

  const dx = sample.center.x - baseline.center.x;
  const dy = sample.center.y - baseline.center.y;

  if (Math.abs(dx) > thresholds.lateralPct) {
    // face shifted right in frame ⇒ user should move left to recenter, etc.
    return {
      status: dx > 0 ? 'shifted-right' : 'shifted-left',
      direction: dx > 0 ? 'left' : 'right',
    };
  }

  if (Math.abs(dy) > thresholds.verticalPct) {
    return {
      status: dy > 0 ? 'shifted-down' : 'shifted-up',
      direction: dy > 0 ? 'up' : 'down',
    };
  }

  const dYaw = Math.abs(sample.pose.yaw - baseline.pose.yaw);
  const dPitch = Math.abs(sample.pose.pitch - baseline.pose.pitch);
  const dRoll = Math.abs(sample.pose.roll - baseline.pose.roll);

  if (dYaw > thresholds.yawDeg || dPitch > thresholds.pitchDeg || dRoll > thresholds.rollDeg) {
    return { status: 'head-turned', direction: 'center' };
  }

  return { status: 'ok', direction: null };
}

/**
 * Tracking confidence 0..1: half for face presence, half for how centred the
 * user is within the safe zone across all axes.
 */
export function computeConfidence(
  sample: PositionSample,
  baseline: HeadBaseline,
  thresholds: HeadThresholds = DEFAULT_THRESHOLDS
): number {
  if (!sample.facePresent) {
    return 0;
  }

  const baseIpd = baseline.ipd || sample.ipd || 1;
  const ipdDev = Math.abs(sample.ipd - baseIpd) / baseIpd / 0.25;
  const latDev = Math.abs(sample.center.x - baseline.center.x) / thresholds.lateralPct;
  const verDev = Math.abs(sample.center.y - baseline.center.y) / thresholds.verticalPct;
  const yawDev = Math.abs(sample.pose.yaw - baseline.pose.yaw) / thresholds.yawDeg;

  const maxDev = Math.max(ipdDev, latDev, verDev, yawDev);
  const centredness = 1 - clamp(maxDev, 0, 1);

  return clamp(0.5 + 0.5 * centredness, 0, 1);
}
