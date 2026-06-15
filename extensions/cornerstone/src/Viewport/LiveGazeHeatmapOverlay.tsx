import React, { useEffect, useRef } from 'react';
import {
  computeIncrementalWeight,
  createDwellState,
  type DwellState,
  type GazeRecord,
} from '@ohif/extension-default/src/ViewerLayout/gazeWeighting';
import {
  computeContentMask,
  getViewportCanvas,
  isContentAt,
  type ContentMask,
} from '@ohif/extension-default/src/ViewerLayout/gazeContentMask';

type HeatmapRecord = {
  x: number;
  y: number;
  value: number;
  sliceIndex: number | null;
  timestamp: number;
};

const MAX_POINTS = 220;
const FADE_MS = 14000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function LiveGazeHeatmapOverlay({
  viewportId,
  servicesManager,
}: {
  viewportId: string;
  servicesManager?: any;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordsRef = useRef<HeatmapRecord[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const currentSliceRef = useRef<number | null>(null);
  const dwellStateRef = useRef<DwellState>(createDwellState());
  const maskRef = useRef<{ sliceIndex: number | null; mask: ContentMask | null } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const getContentMask = (): ContentMask | null => {
      const cornerstoneViewportService = servicesManager?.services?.cornerstoneViewportService;
      const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);

      if (!viewport) {
        return null;
      }

      const sliceIndex = currentSliceRef.current;

      if (maskRef.current && maskRef.current.sliceIndex === sliceIndex) {
        return maskRef.current.mask;
      }

      const mask = computeContentMask(getViewportCanvas(viewport));
      maskRef.current = { sliceIndex, mask };

      return mask;
    };

    const render = () => {
      animationFrameRef.current = null;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(Math.floor(rect.width * window.devicePixelRatio), 1);
      const height = Math.max(Math.floor(rect.height * window.devicePixelRatio), 1);
      const context = canvas.getContext('2d');

      if (!context) {
        return;
      }

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, width, height);

      const now = Date.now();
      const currentSlice = currentSliceRef.current;
      recordsRef.current = recordsRef.current.filter(record => now - record.timestamp < FADE_MS);

      const visibleRecords = recordsRef.current.filter(
        record => currentSlice === null || record.sliceIndex === currentSlice
      );

      if (!visibleRecords.length) {
        return;
      }

      const mask = getContentMask();

      context.save();
      context.scale(window.devicePixelRatio, window.devicePixelRatio);
      context.globalCompositeOperation = 'screen';

      visibleRecords.forEach(record => {
        if (!isContentAt(mask, record.x, record.y)) {
          return;
        }

        const age = clamp(1 - (now - record.timestamp) / FADE_MS, 0, 1);
        const value = clamp(record.value, 0.2, 1) * age;
        const x = record.x * rect.width;
        const y = record.y * rect.height;
        const radius = 34 + value * 46;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);

        gradient.addColorStop(0, `rgba(255, 71, 87, ${0.7 * value})`);
        gradient.addColorStop(0.32, `rgba(255, 204, 0, ${0.42 * value})`);
        gradient.addColorStop(0.7, `rgba(64, 156, 255, ${0.18 * value})`);
        gradient.addColorStop(1, 'rgba(64, 156, 255, 0)');

        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      });

      context.restore();
    };

    const scheduleRender = () => {
      if (animationFrameRef.current !== null) {
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(render);
    };

    const handleGazeRecord = (event: Event) => {
      const record = (event as CustomEvent<GazeRecord & { viewportId?: string }>).detail;

      if (
        !record ||
        record.viewportId !== viewportId ||
        typeof record.viewportNormalizedX !== 'number' ||
        typeof record.viewportNormalizedY !== 'number'
      ) {
        return;
      }

      const sliceIndex = typeof record.sliceIndex === 'number' ? record.sliceIndex : null;

      // slice change invalidates the cached content mask
      if (sliceIndex !== currentSliceRef.current) {
        maskRef.current = null;
      }

      currentSliceRef.current = sliceIndex;

      const weight = computeIncrementalWeight(record, dwellStateRef.current);

      recordsRef.current = [
        ...recordsRef.current,
        {
          x: clamp(record.viewportNormalizedX, 0, 1),
          y: clamp(record.viewportNormalizedY, 0, 1),
          value: weight,
          sliceIndex,
          timestamp: Date.now(),
        },
      ].slice(-MAX_POINTS);

      scheduleRender();
    };

    const resizeObserver = new ResizeObserver(scheduleRender);
    resizeObserver.observe(canvas);
    window.addEventListener('ohif-gaze-record', handleGazeRecord);

    return () => {
      window.removeEventListener('ohif-gaze-record', handleGazeRecord);
      resizeObserver.disconnect();

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [viewportId, servicesManager]);

  return (
    <canvas
      ref={canvasRef}
      className="opacity-85 pointer-events-none absolute inset-0 z-10 h-full w-full mix-blend-screen"
      aria-hidden="true"
    />
  );
}

export default LiveGazeHeatmapOverlay;
