import React, { useEffect, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Button, Icons, useViewportGrid } from '@ohif/ui-next';
import { utils as cornerstoneUtils } from '@ohif/extension-cornerstone';

/** Navigate the same image-linked findings shown in the sidebar list. */
export default function FindingsNavigation() {
  const { commandsManager, servicesManager } = useSystem();
  const { measurementService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;
  const [viewportGrid] = useViewportGrid();
  const [findings, setFindings] = useState<Array<{ uid: string; imageIndex?: number }>>([]);
  const [activeUid, setActiveUid] = useState<string | null>(null);

  useEffect(() => {
    const updateFindings = () => {
      const nextFindings = measurementService
        .getMeasurements()
        .filter(
          measurement =>
            measurement.uid &&
            (measurement.referencedImageId || measurement.metadata?.referencedImageId)
        )
        .map(measurement => {
          const displaySet = measurement.displaySetInstanceUID
            ? displaySetService.getDisplaySetByUID(measurement.displaySetInstanceUID)
            : undefined;
          const imageIndex = displaySet
            ? cornerstoneUtils.getMeasurementSliceIndex(measurement, displaySet)?.imageIndex
            : undefined;

          return { uid: measurement.uid, imageIndex };
        })
        .sort(
          (first, second) =>
            (first.imageIndex ?? Number.MAX_SAFE_INTEGER) -
            (second.imageIndex ?? Number.MAX_SAFE_INTEGER)
        );

      setFindings(nextFindings);
      setActiveUid(current =>
        current && nextFindings.some(finding => finding.uid === current) ? current : null
      );
    };

    updateFindings();
    const events = [
      measurementService.EVENTS.MEASUREMENT_ADDED,
      measurementService.EVENTS.RAW_MEASUREMENT_ADDED,
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      measurementService.EVENTS.MEASUREMENT_REMOVED,
      measurementService.EVENTS.MEASUREMENTS_CLEARED,
    ];
    const subscriptions = events.map(event =>
      measurementService.subscribe(event, updateFindings)
    );

    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [measurementService, displaySetService]);

  if (findings.length < 2 || !viewportGrid.activeViewportId) {
    return null;
  }

  const navigate = (direction: number) => {
    const currentIndex = activeUid
      ? findings.findIndex(finding => finding.uid === activeUid)
      : -1;
    let nextIndex: number;

    if (currentIndex < 0) {
      const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(
        viewportGrid.activeViewportId
      );
      const imageIndex = viewport?.getCurrentImageIdIndex?.();
      let adjacentIndex = -1;
      if (typeof imageIndex === 'number') {
        if (direction > 0) {
          adjacentIndex = findings.findIndex(
            finding => finding.imageIndex !== undefined && finding.imageIndex > imageIndex
          );
        } else {
          for (let index = findings.length - 1; index >= 0; index--) {
            if (findings[index].imageIndex !== undefined && findings[index].imageIndex < imageIndex) {
              adjacentIndex = index;
              break;
            }
          }
        }
      }
      nextIndex = adjacentIndex >= 0 ? adjacentIndex : direction > 0 ? 0 : findings.length - 1;
    } else {
      nextIndex = (currentIndex + direction + findings.length) % findings.length;
    }
    const uid = findings[nextIndex].uid;

    commandsManager.run('jumpToMeasurement', { uid });
    setActiveUid(uid);
  };

  return (
    <div
      role="group"
      className="flex shrink-0 items-center gap-0.5"
      aria-label="Navigate findings"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground h-7 w-7"
        aria-label="Previous finding"
        title="Previous finding"
        onClick={() => navigate(-1)}
      >
        <Icons.ArrowLeftBold className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground h-7 w-7"
        aria-label="Next finding"
        title="Next finding"
        onClick={() => navigate(1)}
      >
        <Icons.ArrowRightBold className="h-4 w-4" />
      </Button>
    </div>
  );
}
