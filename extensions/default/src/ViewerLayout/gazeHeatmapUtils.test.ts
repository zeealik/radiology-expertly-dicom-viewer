import { getHeatmapsBySlice } from './gazeHeatmapUtils';

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

    expect(heatmaps['1']).toEqual([{ x: 10, y: 20, value: 0.7 }]);
    expect(heatmaps['2']).toEqual([{ x: 30, y: 40, value: 0.7 }]);
  });

  it('clamps coordinates to percent bounds', () => {
    const heatmaps = getHeatmapsBySlice([
      { viewportNormalizedX: -0.5, viewportNormalizedY: 1.5, sliceIndex: 0 },
    ]);

    expect(heatmaps['1']).toEqual([{ x: 0, y: 100, value: 0.7 }]);
  });

  it('respects the max points per slice', () => {
    const heatmaps = getHeatmapsBySlice(
      [
        { viewportNormalizedX: 0.1, viewportNormalizedY: 0.2, sliceIndex: 0 },
        { viewportNormalizedX: 0.3, viewportNormalizedY: 0.4, sliceIndex: 0 },
      ],
      1
    );

    expect(heatmaps['1']).toEqual([{ x: 10, y: 20, value: 0.7 }]);
  });

  it('uses confidence and fixation to weight points', () => {
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

    expect(heatmaps['1']).toEqual([
      { x: 10, y: 20, value: 0.5 },
      { x: 30, y: 40, value: 1 },
    ]);
  });
});
