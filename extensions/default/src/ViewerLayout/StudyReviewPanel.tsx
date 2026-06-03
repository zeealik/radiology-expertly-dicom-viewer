import React, { useEffect, useMemo, useState } from 'react';
import { Enums, VolumeViewport3D } from '@cornerstonejs/core';
import { useViewportGrid } from '@ohif/ui-next';

type SubmittedAnswer = {
  questionId: string;
  questionText: string;
  answer: string;
  viewportId?: string;
  slice: number | null;
  numberOfSlices: number | null;
  timestamp: string;
};

type HeatmapPoint = {
  x: number;
  y: number;
  value: number;
};

type StudyReviewData = {
  answers?: SubmittedAnswer[];
  heatmapsBySlice?: Record<string, HeatmapPoint[]>;
  numberOfSlices?: number | null;
  studyInstanceUIDs?: string[];
};

const REVIEW_STORAGE_KEY = 'ohif.studyQuestionReview';

function getStoredReviewData(): StudyReviewData {
  const bridgeData = (window as any).OHIFStudyReviewData;
  if (bridgeData?.answers || bridgeData?.heatmapsBySlice) {
    return bridgeData;
  }

  try {
    const stored = window.sessionStorage.getItem(REVIEW_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function getMockHeatmap(slice: number): HeatmapPoint[] {
  return [0, 1, 2].map(index => ({
    x: 22 + ((slice * 19 + index * 24) % 58),
    y: 18 + ((slice * 31 + index * 17) % 62),
    value: 0.45 + ((slice + index) % 4) * 0.14,
  }));
}

function getHeatmapGradient(points: HeatmapPoint[]): string {
  return points
    .map(point => {
      const alpha = Math.min(Math.max(point.value, 0.2), 1);
      return `radial-gradient(circle at ${point.x}% ${point.y}%, rgba(14, 165, 233, ${alpha}) 0, rgba(14, 165, 233, ${alpha * 0.55}) 7%, rgba(250, 204, 21, ${alpha * 0.42}) 14%, rgba(239, 68, 68, 0) 30%)`;
    })
    .join(', ');
}

function useActiveSlice(
  cornerstoneViewportService,
  activeViewportId
): {
  slice: number | null;
  numberOfSlices: number | null;
} {
  const [sliceState, setSliceState] = useState<{
    slice: number | null;
    numberOfSlices: number | null;
  }>({ slice: null, numberOfSlices: null });

  useEffect(() => {
    if (!activeViewportId || !cornerstoneViewportService) {
      return;
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    const element = viewport?.element;

    if (!viewport || !element || viewport instanceof VolumeViewport3D) {
      return;
    }

    const updateSlice = event => {
      const latestViewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!latestViewport || latestViewport instanceof VolumeViewport3D) {
        return;
      }

      const { imageIndex, newImageIdIndex = imageIndex, imageIdIndex } = event.detail || {};
      const nextImageIndex =
        typeof newImageIdIndex === 'number'
          ? newImageIdIndex
          : typeof imageIdIndex === 'number'
            ? imageIdIndex
            : latestViewport.getCurrentImageIdIndex?.();

      setSliceState({
        slice: typeof nextImageIndex === 'number' ? nextImageIndex + 1 : null,
        numberOfSlices: latestViewport.getNumberOfSlices?.() ?? null,
      });
    };

    try {
      const currentImageIndex = viewport.getCurrentImageIdIndex?.();
      setSliceState({
        slice: typeof currentImageIndex === 'number' ? currentImageIndex + 1 : null,
        numberOfSlices: viewport.getNumberOfSlices?.() ?? null,
      });
    } catch {
      // ignore
    }

    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
    element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);

    return () => {
      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
      element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);
    };
  }, [activeViewportId, cornerstoneViewportService]);

  return sliceState;
}

function clearReviewMode() {
  const url = new URL(window.location.href);
  url.searchParams.delete('studyReview');
  window.location.assign(`${url.pathname}${url.search}`);
}

function StudyReviewPanel({ servicesManager }: withAppTypes): React.ReactElement {
  const [{ activeViewportId }] = useViewportGrid();
  const { cornerstoneViewportService } = servicesManager.services;
  const reviewData = useMemo(getStoredReviewData, []);
  const { slice, numberOfSlices } = useActiveSlice(cornerstoneViewportService, activeViewportId);
  const answers = reviewData.answers || [];

  return (
    <aside className="border-input bg-muted/30 flex h-full w-full shrink-0 flex-col border-t md:w-[380px] md:border-l md:border-t-0">
      <div className="border-input flex min-h-[56px] items-center justify-between border-b px-5">
        <div className="min-w-0">
          <div className="text-foreground text-base font-semibold">Review</div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {slice ? `Slice ${slice}${numberOfSlices ? ` / ${numberOfSlices}` : ''}` : 'Slice -'}
          </div>
        </div>
        <button
          type="button"
          onClick={clearReviewMode}
          className="bg-primary-main hover:bg-primary-light rounded px-3 py-2 text-xs font-semibold text-white"
        >
          Back
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5">
        {answers.length ? (
          answers.map(answer => (
            <article
              key={`${answer.questionId}-${answer.timestamp}`}
              className="border-input bg-background rounded border p-4"
            >
              <div className="text-foreground text-sm font-semibold leading-6">
                {answer.questionText}
              </div>
              <p className="text-muted-foreground mt-2 text-sm leading-6">{answer.answer}</p>
              <div className="text-muted-foreground mt-3 text-xs">
                {answer.slice ? `Answered on slice ${answer.slice}` : 'Slice not captured'}
              </div>
            </article>
          ))
        ) : (
          <div className="border-input bg-background text-muted-foreground rounded border p-4 text-sm">
            No submitted answers found for this review session.
          </div>
        )}
      </div>
    </aside>
  );
}

function StudyReviewHeatmapOverlay({ servicesManager }: withAppTypes): React.ReactElement {
  const [{ activeViewportId }] = useViewportGrid();
  const { cornerstoneViewportService } = servicesManager.services;
  const reviewData = useMemo(getStoredReviewData, []);
  const { slice } = useActiveSlice(cornerstoneViewportService, activeViewportId);
  const heatmapsBySlice = reviewData.heatmapsBySlice || {};
  const points = slice ? heatmapsBySlice[String(slice)] || getMockHeatmap(slice) : [];

  if (!slice || !points.length) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute inset-0 opacity-75 mix-blend-screen"
        style={{ backgroundImage: getHeatmapGradient(points) }}
      />
      <div className="text-muted-foreground absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-xs">
        {heatmapsBySlice[String(slice)] ? 'VR gaze heatmap' : 'Mock gaze heatmap'}
      </div>
    </div>
  );
}

export { StudyReviewHeatmapOverlay };
export default StudyReviewPanel;
