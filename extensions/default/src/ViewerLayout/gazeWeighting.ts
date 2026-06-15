export type GazeRecord = {
  timestamp?: number;
  viewportNormalizedX?: number;
  viewportNormalizedY?: number;
  screenX?: number;
  screenY?: number;
  sliceIndex?: number;
  confidence?: number;
  fixation?: boolean;
  saccades?: boolean;
  [key: string]: unknown;
};

export type HeatmapPoint = {
  x: number;
  y: number;
  value: number;
};

export type WeightedGazeRecord = GazeRecord & { weight: number };

export type GazeWeightingConfig = {
  // speed thresholds in px-equivalent per ms (normalized distance scaled by REF)
  slowSpeed: number;
  fastSpeed: number;
  // normalized distance under which consecutive points count as the same dwell cluster
  dwellRadius: number;
  // dwell duration (ms) that maps to the maximum dwell contribution
  dwellMaxMs: number;
  weights: {
    confidence: number;
    speed: number;
    dwell: number;
    fixation: number;
  };
};

export const DEFAULT_GAZE_WEIGHTING: GazeWeightingConfig = {
  slowSpeed: 0.4,
  fastSpeed: 3.0,
  dwellRadius: 0.03,
  dwellMaxMs: 800,
  weights: {
    confidence: 0.35,
    speed: 0.3,
    dwell: 0.25,
    fixation: 0.1,
  },
};

// Reference dimension used to turn normalized distances into intuitive
// px-equivalent values so the speed thresholds are resolution independent.
const REF = 1000;
const MIN_WEIGHT = 0.2;
const MAX_WEIGHT = 1;

export type DwellState = {
  // start of the current dwell cluster, normalized coords
  anchorX: number | null;
  anchorY: number | null;
  // accumulated dwell time (ms) within the current cluster
  dwellMs: number;
  // last record used for velocity calculation
  prevX: number | null;
  prevY: number | null;
  prevTimestamp: number | null;
  prevSliceIndex: number | null;
};

export function createDwellState(): DwellState {
  return {
    anchorX: null,
    anchorY: null,
    dwellMs: 0,
    prevX: null,
    prevY: null,
    prevTimestamp: null,
    prevSliceIndex: null,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getConfidence(record: GazeRecord) {
  return typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? clamp(record.confidence, 0, 1)
    : 0.7;
}

/**
 * Compute the weight for a single record given the running dwell/velocity state.
 * The state is mutated in place so it can be folded across an ordered sequence
 * (batch) or advanced one record at a time (live streaming) with identical math.
 */
export function computeIncrementalWeight(
  record: GazeRecord,
  state: DwellState,
  config: GazeWeightingConfig = DEFAULT_GAZE_WEIGHTING
): number {
  const { weights } = config;
  const nx = record.viewportNormalizedX;
  const ny = record.viewportNormalizedY;
  const confidence = getConfidence(record);
  const fixationBoost = record.fixation === true ? 1 : 0;

  if (typeof nx !== 'number' || typeof ny !== 'number' || !Number.isFinite(nx) || !Number.isFinite(ny)) {
    // No usable position – fall back to confidence + fixation only.
    return clamp(
      weights.confidence * confidence + weights.fixation * fixationBoost,
      MIN_WEIGHT,
      MAX_WEIGHT
    );
  }

  const timestamp =
    typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)
      ? record.timestamp
      : null;
  const sliceIndex = typeof record.sliceIndex === 'number' ? record.sliceIndex : null;

  const hasPrev =
    state.prevX !== null &&
    state.prevY !== null &&
    state.prevTimestamp !== null &&
    timestamp !== null &&
    // do not compute velocity across a slice change (avoids a fake saccade on scroll)
    (sliceIndex === null || state.prevSliceIndex === null || sliceIndex === state.prevSliceIndex);

  let speedWeight = 0.5;
  let dwellNorm = 0;

  if (hasPrev) {
    const dt = Math.max((timestamp as number) - (state.prevTimestamp as number), 1);
    const dx = (nx - (state.prevX as number)) * REF;
    const dy = (ny - (state.prevY as number)) * REF;
    const dist = Math.hypot(dx, dy);
    const speed = dist / dt;

    const speedNorm = clamp(
      (config.fastSpeed - speed) / (config.fastSpeed - config.slowSpeed),
      0,
      1
    );
    speedWeight = Math.pow(speedNorm, 0.7);

    // Dwell: accumulate time while gaze stays within the cluster radius.
    const anchorX = state.anchorX ?? (state.prevX as number);
    const anchorY = state.anchorY ?? (state.prevY as number);
    const driftX = (nx - anchorX) * REF;
    const driftY = (ny - anchorY) * REF;
    const drift = Math.hypot(driftX, driftY);

    if (drift <= config.dwellRadius * REF) {
      state.dwellMs += dt;
      state.anchorX = anchorX;
      state.anchorY = anchorY;
    } else {
      state.dwellMs = 0;
      state.anchorX = nx;
      state.anchorY = ny;
    }

    dwellNorm = clamp(state.dwellMs / config.dwellMaxMs, 0, 1);
  } else {
    // First record (or post slice-change reset): neutral speed/dwell, start a cluster.
    state.dwellMs = 0;
    state.anchorX = nx;
    state.anchorY = ny;
    speedWeight = 0;
    dwellNorm = 0;
  }

  state.prevX = nx;
  state.prevY = ny;
  state.prevTimestamp = timestamp;
  state.prevSliceIndex = sliceIndex;

  const raw =
    weights.confidence * confidence +
    weights.speed * speedWeight +
    weights.dwell * dwellNorm +
    weights.fixation * fixationBoost;

  return clamp(raw, MIN_WEIGHT, MAX_WEIGHT);
}

/**
 * Weight an ordered sequence of gaze records, accounting for eye-movement speed
 * (slow = focus, fast = scanning), dwell duration, fixation and confidence.
 */
export function computeGazeWeights(
  records: GazeRecord[],
  config: GazeWeightingConfig = DEFAULT_GAZE_WEIGHTING
): WeightedGazeRecord[] {
  const state = createDwellState();

  return records.map(record => ({
    ...record,
    weight: computeIncrementalWeight(record, state, config),
  }));
}
