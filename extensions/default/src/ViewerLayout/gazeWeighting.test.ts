import { computeGazeWeights } from './gazeWeighting';
import type { GazeRecord } from './gazeWeighting';

function record(partial: Partial<GazeRecord>): GazeRecord {
  return {
    viewportNormalizedX: 0.5,
    viewportNormalizedY: 0.5,
    sliceIndex: 0,
    timestamp: 0,
    ...partial,
  };
}

describe('computeGazeWeights', () => {
  it('weights slow, close movement higher than fast movement', () => {
    // slow: small distance over a long time
    const slow = computeGazeWeights([
      record({ viewportNormalizedX: 0.5, viewportNormalizedY: 0.5, timestamp: 0 }),
      record({ viewportNormalizedX: 0.505, viewportNormalizedY: 0.505, timestamp: 400 }),
    ]);

    // fast: large distance over a short time
    const fast = computeGazeWeights([
      record({ viewportNormalizedX: 0.1, viewportNormalizedY: 0.1, timestamp: 0 }),
      record({ viewportNormalizedX: 0.9, viewportNormalizedY: 0.9, timestamp: 20 }),
    ]);

    expect(slow[1].weight).toBeGreaterThan(fast[1].weight);
  });

  it('increases weight the longer the gaze dwells in one place', () => {
    const records: GazeRecord[] = [];
    for (let i = 0; i < 6; i++) {
      records.push(record({ viewportNormalizedX: 0.5, viewportNormalizedY: 0.5, timestamp: i * 150 }));
    }

    const weights = computeGazeWeights(records).map(r => r.weight);

    // dwell accumulates, so later points should be at least as hot as earlier ones
    for (let i = 2; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]);
    }
    expect(weights[weights.length - 1]).toBeGreaterThan(weights[1]);
  });

  it('does not treat a slice change as a high-speed saccade', () => {
    // big jump across a slice change => treated as a fresh first record (reset),
    // so the second point is NOT penalised for a fake high speed.
    const crossSlice = computeGazeWeights([
      record({ viewportNormalizedX: 0.1, viewportNormalizedY: 0.1, sliceIndex: 0, timestamp: 0 }),
      record({ viewportNormalizedX: 0.9, viewportNormalizedY: 0.9, sliceIndex: 1, timestamp: 10 }),
    ]);

    // a single neutral first record for reference
    const firstOnly = computeGazeWeights([
      record({ viewportNormalizedX: 0.9, viewportNormalizedY: 0.9, sliceIndex: 1, timestamp: 0 }),
    ]);

    // same big jump but within one slice => penalised as a fast saccade
    const inSlice = computeGazeWeights([
      record({ viewportNormalizedX: 0.1, viewportNormalizedY: 0.1, sliceIndex: 0, timestamp: 0 }),
      record({ viewportNormalizedX: 0.9, viewportNormalizedY: 0.9, sliceIndex: 0, timestamp: 10 }),
    ]);

    // cross-slice point matches a fresh first record (the reset), and is at least
    // as hot as the speed-penalised in-slice move.
    expect(crossSlice[1].weight).toBeCloseTo(firstOnly[0].weight, 5);
    expect(crossSlice[1].weight).toBeGreaterThanOrEqual(inSlice[1].weight);
  });

  it('guards against identical timestamps (no Infinity / NaN)', () => {
    const weights = computeGazeWeights([
      record({ viewportNormalizedX: 0.1, viewportNormalizedY: 0.1, timestamp: 100 }),
      record({ viewportNormalizedX: 0.9, viewportNormalizedY: 0.9, timestamp: 100 }),
    ]);

    weights.forEach(({ weight }) => {
      expect(Number.isFinite(weight)).toBe(true);
      expect(weight).toBeGreaterThanOrEqual(0.2);
      expect(weight).toBeLessThanOrEqual(1);
    });
  });

  it('falls back to confidence + fixation when timestamp is missing', () => {
    const [weighted] = computeGazeWeights([
      record({ confidence: 0.8, fixation: true, timestamp: undefined }),
    ]);

    // 0.35*0.8 + 0.1*1 = 0.38
    expect(weighted.weight).toBeCloseTo(0.38, 5);
  });

  it('defaults confidence to 0.7 when absent', () => {
    const [weighted] = computeGazeWeights([record({ confidence: undefined })]);

    // first record: 0.35 * 0.7 = 0.245
    expect(weighted.weight).toBeCloseTo(0.245, 5);
  });
});
