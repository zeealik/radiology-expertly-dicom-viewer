import { getHeatmapsBySlice } from './gazeHeatmapUtils';

// The first record in a sequence has no predecessor, so its weight reduces to
// confidence * weights.confidence (+ fixation), clamped to [0.2, 1]. Default
// confidence is 0.7 => 0.7 * 0.35 = 0.245.
const FIRST_RECORD_DEFAULT_WEIGHT = 0.245;

describe('getHeatmapsBySlice', () => {
  it('ignores records without normalized coordinates or slice indexes', () => {
    const heatmaps = getHeatmapsBySlice([
      { viewportNormalizedX: 0.1, viewportNormalizedY: 0.2 },
      { viewportNormalizedX: 0.1, sliceIndex: 0 },
      { viewportNormalizedY: 0.2, sliceIndex: 0 },
    ]);

    expect(heatmaps).toEqual({});
  });

  it('groups points by one-based slice index', () => {
    const heatmaps = getHeatmapsBySlice([
      { viewportNormalizedX: 0.1, viewportNormalizedY: 0.2, sliceIndex: 0 },
      { viewportNormalizedX: 0.3, viewportNormalizedY: 0.4, sliceIndex: 1 },
    ]);

    // each is the first record on its slice => default first-record weight
    expect(heatmaps['1']).toHaveLength(1);
    expect(heatmaps['1'][0]).toMatchObject({ x: 10, y: 20 });
    expect(heatmaps['1'][0].value).toBeCloseTo(FIRST_RECORD_DEFAULT_WEIGHT, 5);
    expect(heatmaps['2']).toHaveLength(1);
    expect(heatmaps['2'][0]).toMatchObject({ x: 30, y: 40 });
    expect(heatmaps['2'][0].value).toBeCloseTo(FIRST_RECORD_DEFAULT_WEIGHT, 5);
  });

  it('clamps coordinates to percent bounds', () => {
    const heatmaps = getHeatmapsBySlice([
      { viewportNormalizedX: -0.5, viewportNormalizedY: 1.5, sliceIndex: 0 },
    ]);

    expect(heatmaps['1'][0]).toMatchObject({ x: 0, y: 100 });
    expect(heatmaps['1'][0].value).toBeCloseTo(FIRST_RECORD_DEFAULT_WEIGHT, 5);
  });

  it('respects the max points per slice', () => {
    const heatmaps = getHeatmapsBySlice(
      [
        { viewportNormalizedX: 0.1, viewportNormalizedY: 0.2, sliceIndex: 0 },
        { viewportNormalizedX: 0.3, viewportNormalizedY: 0.4, sliceIndex: 0 },
      ],
      1
    );

    expect(heatmaps['1']).toHaveLength(1);
    expect(heatmaps['1'][0]).toMatchObject({ x: 10, y: 20 });
  });

  it('keeps weights within the [0.2, 1] range', () => {
    const heatmaps = getHeatmapsBySlice([
      { viewportNormalizedX: 0.1, viewportNormalizedY: 0.2, sliceIndex: 0, confidence: 0.5 },
      {
        viewportNormalizedX: 0.3,
        viewportNormalizedY: 0.4,
        sliceIndex: 0,
        confidence: 0.9,
        fixation: true,
      },
    ]);

    const points = heatmaps['1'];
    expect(points).toHaveLength(2);
    points.forEach(point => {
      expect(point.value).toBeGreaterThanOrEqual(0.2);
      expect(point.value).toBeLessThanOrEqual(1);
    });
  });
});
