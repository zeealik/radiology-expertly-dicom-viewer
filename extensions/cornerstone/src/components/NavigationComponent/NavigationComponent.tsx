import React, { useCallback, useState } from 'react';
import { ViewportActionArrows } from '@ohif/ui-next';
import { useSystem } from '@ohif/core/src';
import { utils } from '../..';
import { useViewportSegmentations } from '../../hooks';
import { useMeasurementTracking } from '../../hooks/useMeasurementTracking';
import { useViewportDisplaySets } from '../../hooks/useViewportDisplaySets';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

/**
 * NavigationComponent provides navigation controls for viewports containing
 * special displaySets (SR, SEG, RTSTRUCT) to navigate between segments or measurements
 */
function NavigationComponent({ viewportId }: { viewportId: string }) {
  const { servicesManager } = useSystem();
  const { segmentationService, cornerstoneViewportService, measurementService } =
    servicesManager.services;

  // Get tracking information
  const { isTracked, trackedMeasurementUIDs } = useMeasurementTracking({ viewportId });
  const { viewportDisplaySets } = useViewportDisplaySets(viewportId);
  const [measurementSelected, setMeasurementSelected] = useState(0);
  const measurementDisplaySet = viewportDisplaySets.find(
    displaySet => displaySet?.Modality === 'SR'
  ) as (AppTypes.DisplaySet & { measurements?: Array<{ imageId?: string }> }) | undefined;
  const srMeasurements = (measurementDisplaySet?.measurements ?? []).filter(
    measurement => measurement?.imageId
  );
  const cornerstoneViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

  // Get segmentation information
  const { segmentationsWithRepresentations } = useViewportSegmentations({
    viewportId,
  });

  const navigableSegmentations = segmentationsWithRepresentations.filter(
    segmentation =>
      segmentation?.segmentation?.segmentationId &&
      Object.keys(segmentation.segmentation.segments ?? {}).length > 1 &&
      segmentation?.representation?.type !== SegmentationRepresentations.Surface
  );
  let navigationMode: 'segment' | 'measurement' | null = null;

  if (navigableSegmentations.length > 0) {
    navigationMode = 'segment';
  } else if (
    (srMeasurements.length > 1 && cornerstoneViewport) ||
    (isTracked && trackedMeasurementUIDs.length > 1)
  ) {
    navigationMode = 'measurement';
  }

  const handleMeasurementNavigation = useCallback(
    (direction: number) => {
      if (srMeasurements.length > 1 && cornerstoneViewport) {
        const newIndex = getNextIndex(measurementSelected, direction, srMeasurements.length);
        setMeasurementSelected(newIndex);

        const measurement = srMeasurements[newIndex];
        cornerstoneViewport.setViewReference({
          referencedImageId: measurement.imageId,
        });
        return;
      }

      if (isTracked && trackedMeasurementUIDs.length > 1) {
        const newIndex = getNextIndex(
          measurementSelected,
          direction,
          trackedMeasurementUIDs.length
        );
        setMeasurementSelected(newIndex);
        measurementService.jumpToMeasurement(viewportId, trackedMeasurementUIDs[newIndex]);
      }
    },
    [
      viewportId,
      cornerstoneViewport,
      measurementSelected,
      measurementService,
      isTracked,
      trackedMeasurementUIDs,
      srMeasurements,
    ]
  );

  const handleSegmentNavigation = useCallback(
    (direction: number) => {
      if (!navigableSegmentations.length) {
        return;
      }

      const activeSegmentationWithRepresentation = navigableSegmentations.find(
        segmentation => segmentation?.representation?.active
      ) ?? navigableSegmentations[0];
      const segmentationId = activeSegmentationWithRepresentation.segmentation.segmentationId;

      utils.handleSegmentChange({
        direction,
        segmentationId,
        viewportId,
        selectedSegmentObjectIndex: 0,
        segmentationService,
      });
    },
    [navigableSegmentations, viewportId, segmentationService]
  );

  // Handle navigation between segments/measurements
  const handleNavigate = useCallback(
    (direction: number) => {
      if (navigationMode === 'segment') {
        handleSegmentNavigation(direction);
      } else if (navigationMode === 'measurement') {
        handleMeasurementNavigation(direction);
      }
    },
    [navigationMode, handleSegmentNavigation, handleMeasurementNavigation]
  );

  // Only render if we have a navigation mode
  if (!navigationMode) {
    return null;
  }

  return (
    <ViewportActionArrows
      onArrowsClick={handleNavigate}
      className="mr-6 h-8"
    />
  );
}

/**
 * Calculate the next index with circular navigation support
 * @param currentIndex Current index position
 * @param direction Direction of movement (1 for next, -1 for previous)
 * @param totalItems Total number of items to navigate through
 * @returns The next index with wrap-around support
 */
function getNextIndex(currentIndex: number, direction: number, totalItems: number): number {
  if (totalItems <= 0) {
    return 0;
  }

  // Use modulo to handle circular navigation
  let nextIndex = (currentIndex + direction) % totalItems;

  // Handle negative index when going backwards from index 0
  if (nextIndex < 0) {
    nextIndex = totalItems - 1;
  }

  return nextIndex;
}

export default NavigationComponent;
