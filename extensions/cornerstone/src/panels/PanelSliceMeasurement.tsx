import React, { useEffect, useState } from 'react';
import { Enums } from '@cornerstonejs/core';
import { useSystem } from '@ohif/core';

import { useMeasurements } from '../hooks/useMeasurements';
import SliceMeasurements from '../components/SliceMeasurements';

/**
 * Tracks which slice the active viewport is currently showing.
 *
 * The slice group matching the current position is highlighted, so the panel always shows
 * where the user is in the stack. Cornerstone fires STACK_NEW_IMAGE / VOLUME_NEW_IMAGE on
 * the viewport element as it scrolls; the element is only available once the viewport has
 * rendered, so this re-attaches whenever the active viewport changes.
 */
function useActiveImageIndex(): number | undefined {
  const { servicesManager } = useSystem();
  const { cornerstoneViewportService, viewportGridService } = servicesManager.services;
  const [activeImageIndex, setActiveImageIndex] = useState<number | undefined>(undefined);

  useEffect(() => {
    let removeListeners: (() => void) | undefined;
    let retryHandle: ReturnType<typeof window.setTimeout> | undefined;

    const attach = () => {
      const viewportId = viewportGridService.getActiveViewportId?.();
      const viewport = viewportId
        ? cornerstoneViewportService?.getCornerstoneViewport?.(viewportId)
        : undefined;
      const element = viewport?.element;

      removeListeners?.();

      if (!element) {
        retryHandle = window.setTimeout(attach, 250);
        return;
      }

      const update = () => setActiveImageIndex(viewport.getCurrentImageIdIndex?.());
      update();

      element.addEventListener(Enums.Events.STACK_NEW_IMAGE, update);
      element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, update);
      removeListeners = () => {
        element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, update);
        element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, update);
      };
    };

    attach();

    const activeViewportSubscription = viewportGridService.subscribe?.(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      attach
    );
    const viewportDataSubscription = cornerstoneViewportService?.EVENTS?.VIEWPORT_DATA_CHANGED
      ? cornerstoneViewportService.subscribe?.(
          cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
          attach
        )
      : undefined;

    return () => {
      if (retryHandle) {
        window.clearTimeout(retryHandle);
      }
      activeViewportSubscription?.unsubscribe?.();
      viewportDataSubscription?.unsubscribe?.();
      removeListeners?.();
    };
  }, [cornerstoneViewportService, viewportGridService]);

  return activeImageIndex;
}

/**
 * Findings panel that groups annotations by the slice they were drawn on.
 *
 * The slice-grouped counterpart to PanelMeasurement, which groups by study and series.
 */
export default function PanelSliceMeasurement(props): React.ReactNode {
  const { measurementFilter, emptyComponent: EmptyComponent, children } = props;

  const displayMeasurements = useMeasurements({ measurementFilter });
  const activeImageIndex = useActiveImageIndex();

  if (!displayMeasurements.length) {
    return EmptyComponent ? (
      <EmptyComponent items={displayMeasurements} />
    ) : (
      <span className="text-foreground">No findings</span>
    );
  }

  return (
    <SliceMeasurements
      items={displayMeasurements}
      activeImageIndex={activeImageIndex}
      grouping={{ filter: measurementFilter }}
    >
      {children}
    </SliceMeasurements>
  );
}
