export type GazeRecord = {
  viewportNormalizedX?: number;
  viewportNormalizedY?: number;
  sliceIndex?: number;
  confidence?: number;
  fixation?: boolean;
  [key: string]: unknown;
};

export type HeatmapPoint = {
  x: number;
  y: number;
  value: number;
};

export const MAX_HEATMAP_POINTS_PER_SLICE = 250;

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

export function getHeatmapsBySlice(
  gazeRecords: GazeRecord[],
  maxPointsPerSlice = MAX_HEATMAP_POINTS_PER_SLICE
): Record<string, HeatmapPoint[]> {
  return gazeRecords.reduce<Record<string, HeatmapPoint[]>>((heatmapsBySlice, record) => {
    const { viewportNormalizedX, viewportNormalizedY, sliceIndex } = record;

    if (
      typeof viewportNormalizedX !== 'number' ||
      typeof viewportNormalizedY !== 'number' ||
      typeof sliceIndex !== 'number'
    ) {
      return heatmapsBySlice;
    }

    const slice = String(sliceIndex + 1);
    const points = heatmapsBySlice[slice] || [];

    if (points.length >= maxPointsPerSlice) {
      return heatmapsBySlice;
    }

    const confidence = typeof record.confidence === 'number' ? record.confidence : 0.7;
    const fixationBoost = record.fixation === true ? 0.2 : 0;

    points.push({
      x: clampPercent(viewportNormalizedX * 100),
      y: clampPercent(viewportNormalizedY * 100),
      value: Math.min(Math.max(confidence + fixationBoost, 0.2), 1),
    });
    heatmapsBySlice[slice] = points;

    return heatmapsBySlice;
  }, {});
}
