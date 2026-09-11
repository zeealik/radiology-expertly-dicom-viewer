import getMeasurementSliceIndex from '../utils/getMeasurementSliceIndex';

/**
 * Groups measurements by the slice they were drawn on.
 *
 * Every annotation belongs to exactly one image, so the panel shows one fold per slice
 * ("Slice 23"), holding every annotation on that slice regardless of tool. Groups are
 * ordered by slice so the list reads in the same direction the user scrolls.
 *
 * Measurements that cannot be tied to an image — 3D (SCOORD3D) annotations, or instances
 * missing from the display set — are collected into a trailing "Other findings" group
 * rather than being dropped or guessed into a slice.
 */

export const UNGROUPED_KEY = 'ungrouped-findings';

type GroupingContext = {
  activeImageIndex?: number;
  filter?: (measurement: unknown) => boolean;
  [key: string]: unknown;
};

export const groupBySlice = (items, grouping: GroupingContext, childProps) => {
  const { displaySetService } = childProps.servicesManager.services;
  const { activeImageIndex } = grouping;

  const groups = new Map();

  const getDisplaySet = item =>
    item.displaySetInstanceUID
      ? displaySetService.getDisplaySetByUID(item.displaySetInstanceUID)
      : undefined;

  items.forEach(item => {
    const displaySet = getDisplaySet(item);
    const location = displaySet ? getMeasurementSliceIndex(item, displaySet) : undefined;

    const key = location ? `slice-${location.imageIndex}` : UNGROUPED_KEY;

    if (!groups.has(key)) {
      groups.set(key, {
        ...grouping,
        items: [],
        displayMeasurements: [],
        key,
        // `sliceNumber` absent marks the trailing catch-all group.
        sliceNumber: location?.sliceNumber,
        imageIndex: location?.imageIndex,
        referencedImageId: item.referencedImageId || item.metadata?.referencedImageId,
        displaySetInstanceUID: item.displaySetInstanceUID,
        title: location ? `Slice ${location.sliceNumber}` : 'Other findings',
        isSelected: location ? location.imageIndex === activeImageIndex : false,
      });
    }

    const group = groups.get(key);
    group.items.push(item);
    group.displayMeasurements = group.items;
  });

  // Slice order, with the unlocatable findings last.
  const ordered = [...groups.entries()].sort(([, a], [, b]) => {
    if (a.sliceNumber === undefined) {
      return 1;
    }
    if (b.sliceNumber === undefined) {
      return -1;
    }
    return a.sliceNumber - b.sliceNumber;
  });

  return new Map(ordered);
};

export default groupBySlice;
