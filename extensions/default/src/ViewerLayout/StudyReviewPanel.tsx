import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Enums, VolumeViewport3D } from '@cornerstonejs/core';
import { Icons, useViewportGrid } from '@ohif/ui-next';
import {
  computeContentMask,
  getViewportCanvas,
  isContentAt,
  type ContentMask,
} from './gazeContentMask';
import { computeGazeWeights } from './gazeWeighting';
import type { GazeRecord, HeatmapPoint } from './gazeHeatmapUtils';

type SubmittedAnswer = {
  questionId: string;
  questionText: string;
  answer: string;
  viewportId?: string;
  slice: number | null;
  numberOfSlices: number | null;
  timestamp: string;
};

type StudyReviewData = {
  answers?: SubmittedAnswer[];
  gazeRecords?: GazeRecord[];
  heatmapsBySlice?: Record<string, HeatmapPoint[]>;
  numberOfSlices?: number | null;
  studyInstanceUIDs?: string[];
};

type CanvasHeatmapPoint = {
  x: number;
  y: number;
  // normalized (0-1) position within the viewport, used for content masking
  nx: number;
  ny: number;
  value: number;
};

type WeightedGazeRecord = GazeRecord & { weight: number };

const REVIEW_STORAGE_KEY = 'ohif.studyQuestionReview';

type StackLikeViewport = {
  element?: HTMLElement;
  getCurrentImageIdIndex?: () => number;
  getNumberOfSlices?: () => number;
};

type CornerstoneViewportService = {
  EVENTS?: {
    VIEWPORT_DATA_CHANGED?: string;
  };
  getCornerstoneViewport?: (viewportId: string) => StackLikeViewport | VolumeViewport3D | undefined;
  subscribe?: (
    eventName: string,
    callback: (event: { viewportId?: string }) => void
  ) => { unsubscribe?: () => void };
};

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

function useActiveSlice(
  cornerstoneViewportService: CornerstoneViewportService | undefined,
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

    let removeViewportListeners: (() => void) | undefined;
    let retryIntervalId: number | undefined;

    const syncSliceState = event => {
      const latestViewport = cornerstoneViewportService.getCornerstoneViewport?.(activeViewportId);
      if (!latestViewport || latestViewport instanceof VolumeViewport3D) {
        setSliceState({
          slice: null,
          numberOfSlices: null,
        });
        return false;
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

      return true;
    };

    const attachViewportListeners = () => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport?.(activeViewportId);
      const element = viewport?.element;

      if (!viewport || !element || viewport instanceof VolumeViewport3D) {
        syncSliceState({ detail: {} });
        return false;
      }

      removeViewportListeners?.();

      const updateSlice = event => {
        syncSliceState(event);
      };

      syncSliceState({ detail: {} });

      element.addEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
      element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
      element.addEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);

      removeViewportListeners = () => {
        element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
        element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
        element.removeEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);
      };

      return true;
    };

    if (!attachViewportListeners()) {
      retryIntervalId = window.setInterval(() => {
        if (attachViewportListeners() && retryIntervalId) {
          window.clearInterval(retryIntervalId);
          retryIntervalId = undefined;
        }
      }, 250);
    }

    const viewportDataChangedEvent = cornerstoneViewportService.EVENTS?.VIEWPORT_DATA_CHANGED || '';
    const subscription =
      viewportDataChangedEvent && cornerstoneViewportService.subscribe
        ? cornerstoneViewportService.subscribe(viewportDataChangedEvent, event => {
            if (!event?.viewportId || event.viewportId === activeViewportId) {
              attachViewportListeners();
            }
          })
        : undefined;

    return () => {
      if (retryIntervalId) {
        window.clearInterval(retryIntervalId);
      }

      subscription?.unsubscribe?.();
      removeViewportListeners?.();
    };
  }, [activeViewportId, cornerstoneViewportService]);

  return sliceState;
}

function getClearReviewPath() {
  const url = new URL(window.location.href);
  url.searchParams.delete('studyReview');

  return `${url.pathname}${url.search}`;
}

function getFeedbackPath() {
  const url = new URL(window.location.href);
  url.searchParams.delete('studyReview');
  url.searchParams.set('studyFeedback', '1');

  return `${url.pathname}${url.search}`;
}

function getCanvasHeatmapPoints({
  reviewData,
  weightedRecords,
  slice,
  viewport,
  rect,
}: {
  reviewData: StudyReviewData;
  weightedRecords: WeightedGazeRecord[];
  slice: number | null;
  viewport: any;
  rect: DOMRect;
}): CanvasHeatmapPoint[] {
  if (!slice) {
    return [];
  }

  if (weightedRecords.length) {
    return weightedRecords.reduce<CanvasHeatmapPoint[]>((points, record) => {
      if (record.sliceIndex !== slice - 1) {
        return points;
      }

      const world = Array.isArray(record.world) ? record.world : undefined;

      if (world?.length === 3 && typeof viewport?.worldToCanvas === 'function') {
        const [x, y] = viewport.worldToCanvas(world);

        if (Number.isFinite(x) && Number.isFinite(y)) {
          points.push({
            x,
            y,
            nx: rect.width ? x / rect.width : 0,
            ny: rect.height ? y / rect.height : 0,
            value: record.weight,
          });
          return points;
        }
      }

      if (
        typeof record.viewportNormalizedX === 'number' &&
        typeof record.viewportNormalizedY === 'number'
      ) {
        points.push({
          x: record.viewportNormalizedX * rect.width,
          y: record.viewportNormalizedY * rect.height,
          nx: record.viewportNormalizedX,
          ny: record.viewportNormalizedY,
          value: record.weight,
        });
      }

      return points;
    }, []);
  }

  return (reviewData.heatmapsBySlice?.[String(slice)] || []).map(point => ({
    x: (point.x / 100) * rect.width,
    y: (point.y / 100) * rect.height,
    nx: point.x / 100,
    ny: point.y / 100,
    value: point.value,
  }));
}

type StudyReviewPanelProps = withAppTypes<{
  onToggleCollapsed?: () => void;
}>;

function StudyReviewPanel({
  servicesManager,
  onToggleCollapsed,
}: StudyReviewPanelProps): React.ReactElement {
  const navigate = useNavigate();
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(getClearReviewPath())}
            className="bg-primary-main hover:bg-primary-light rounded px-3 py-2 text-xs font-semibold text-white"
          >
            Back
          </button>
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse review panel"
              title="Collapse review panel"
              className="hover:bg-primary/10 focus:ring-primary-main text-primary flex h-8 w-8 items-center justify-center rounded transition focus:outline-none focus:ring-2"
            >
              <Icons.SidePanelCloseRight className="h-5 w-5" />
            </button>
          )}
        </div>
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

      <div className="border-input border-t p-5">
        <button
          type="button"
          onClick={() => navigate(getFeedbackPath())}
          className="bg-primary-main hover:bg-primary-light focus:ring-primary-main w-full rounded px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2"
        >
          Continue to Feedback
        </button>
      </div>
    </aside>
  );
}

function StudyReviewHeatmapOverlay({ servicesManager }: withAppTypes): React.ReactElement {
  const [{ activeViewportId }] = useViewportGrid();
  const { cornerstoneViewportService } = servicesManager.services;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<{ sliceIndex: number | null; mask: ContentMask | null } | null>(null);
  const reviewData = useMemo(getStoredReviewData, []);
  const weightedRecords = useMemo<WeightedGazeRecord[]>(
    () => computeGazeWeights(reviewData.gazeRecords || []),
    [reviewData]
  );
  const { slice } = useActiveSlice(cornerstoneViewportService, activeViewportId);
  const hasGazeData =
    !!reviewData.gazeRecords?.length ||
    !!(slice && reviewData.heatmapsBySlice?.[String(slice)]?.length);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const render = () => {
      const viewport = activeViewportId
        ? cornerstoneViewportService?.getCornerstoneViewport(activeViewportId)
        : null;
      const viewportElement = viewport?.element;
      const root = rootRef.current;

      if (!viewportElement || !root) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const viewportRect = viewportElement.getBoundingClientRect();
      const rect = viewportRect;
      const width = Math.max(Math.floor(rect.width * window.devicePixelRatio), 1);
      const height = Math.max(Math.floor(rect.height * window.devicePixelRatio), 1);
      const context = canvas.getContext('2d');

      if (!context) {
        return;
      }

      canvas.style.left = `${viewportRect.left - rootRect.left}px`;
      canvas.style.top = `${viewportRect.top - rootRect.top}px`;
      canvas.style.width = `${viewportRect.width}px`;
      canvas.style.height = `${viewportRect.height}px`;
      const points = getCanvasHeatmapPoints({
        reviewData,
        weightedRecords,
        slice,
        viewport,
        rect,
      });

      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);

      if (!points.length) {
        return;
      }

      let mask: ContentMask | null;
      if (maskRef.current && maskRef.current.sliceIndex === slice) {
        mask = maskRef.current.mask;
      } else {
        mask = computeContentMask(getViewportCanvas(viewport));
        maskRef.current = { sliceIndex: slice, mask };
      }

      context.scale(window.devicePixelRatio, window.devicePixelRatio);
      context.globalCompositeOperation = 'screen';

      points.forEach(point => {
        if (!isContentAt(mask, point.nx, point.ny)) {
          return;
        }

        const value = Math.min(Math.max(point.value, 0.2), 1);
        const radius = 42 + value * 34;
        const gradient = context.createRadialGradient(
          point.x,
          point.y,
          0,
          point.x,
          point.y,
          radius
        );

        gradient.addColorStop(0, `rgba(239, 68, 68, ${0.72 * value})`);
        gradient.addColorStop(0.34, `rgba(250, 204, 21, ${0.48 * value})`);
        gradient.addColorStop(0.68, `rgba(14, 165, 233, ${0.2 * value})`);
        gradient.addColorStop(1, 'rgba(14, 165, 233, 0)');

        context.fillStyle = gradient;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      });
    };

    render();

    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    if (rootRef.current) {
      observer.observe(rootRef.current);
    }

    const viewport = activeViewportId
      ? cornerstoneViewportService?.getCornerstoneViewport(activeViewportId)
      : null;
    const element = viewport?.element;

    if (element) {
      observer.observe(element);
    }

    element?.addEventListener(Enums.Events.STACK_NEW_IMAGE, render);
    element?.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, render);
    element?.addEventListener(Enums.Events.IMAGE_RENDERED, render);

    return () => {
      observer.disconnect();
      element?.removeEventListener(Enums.Events.STACK_NEW_IMAGE, render);
      element?.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, render);
      element?.removeEventListener(Enums.Events.IMAGE_RENDERED, render);
    };
  }, [activeViewportId, cornerstoneViewportService, reviewData, weightedRecords, slice]);

  if (!slice) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-10"
    >
      <canvas
        ref={canvasRef}
        className="absolute opacity-80 mix-blend-screen"
      />
      <div className="text-muted-foreground absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-xs">
        {hasGazeData ? 'EyeGestures gaze heatmap' : 'No gaze data captured'}
      </div>
    </div>
  );
}

export { StudyReviewHeatmapOverlay };
export default StudyReviewPanel;
