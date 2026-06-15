import { computeGazeWeights } from './gazeWeighting';
import type { GazeRecord, HeatmapPoint } from './gazeWeighting';

export type { GazeRecord, HeatmapPoint };

export const MAX_HEATMAP_POINTS_PER_SLICE = 250;

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

export function getHeatmapsBySlice(
  gazeRecords: GazeRecord[],
  maxPointsPerSlice = MAX_HEATMAP_POINTS_PER_SLICE
): Record<string, HeatmapPoint[]> {
  const weightedRecords = computeGazeWeights(gazeRecords);

  return weightedRecords.reduce<Record<string, HeatmapPoint[]>>((heatmapsBySlice, record) => {
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

    points.push({
      x: clampPercent(viewportNormalizedX * 100),
      y: clampPercent(viewportNormalizedY * 100),
      value: record.weight,
    });
    heatmapsBySlice[slice] = points;

    return heatmapsBySlice;
  }, {});
}
