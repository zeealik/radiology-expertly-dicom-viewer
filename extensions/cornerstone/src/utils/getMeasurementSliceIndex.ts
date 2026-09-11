/**
 * Resolves the slice a measurement was drawn on.
 *
 * Findings are grouped in the panel by slice, so each measurement needs a stable,
 * human-meaningful slice number. `ImageSet` assigns `instances` and `images` the same
 * array reference, already sorted (by patient position when reconstructable, otherwise
 * by InstanceNumber), so a measurement's position within `instances` is the same index
 * the viewport reports via `getCurrentImageIdIndex()`. Using that index — rather than
 * the DICOM InstanceNumber tag — keeps the panel label matching the scrollbar position
 * the user sees while annotating.
 */

/** The 1-based slice number shown to the user, plus the 0-based index used to navigate. */
export type MeasurementSliceLocation = {
  /** 0-based position within the display set, suitable for `jumpToImage`. */
  imageIndex: number;
  /** 1-based number for display, e.g. `Slice 23`. */
  sliceNumber: number;
  /** Frame within the instance, for multi-frame instances (1-based, DICOM convention). */
  frameNumber: number;
};

type Instance = {
  SOPInstanceUID?: string;
  NumberOfFrames?: number;
};

type DisplaySetLike = {
  instances?: Instance[];
  images?: Instance[];
};

type MeasurementLike = {
  SOPInstanceUID?: string;
  frameNumber?: number;
  referencedImageId?: string;
  metadata?: { referencedImageId?: string };
};

/**
 * Extracts the SOPInstanceUID from a wadors/dicomweb imageId.
 *
 * Cornerstone imageIds embed the instance UID as the final `/instances/<uid>/frames/<n>`
 * segment. This is a fallback for measurements whose `SOPInstanceUID` was not populated
 * (hydrated SR measurements sometimes carry only the referenced image id).
 */
export function getSOPInstanceUIDFromImageId(imageId?: string): string | undefined {
  if (!imageId) {
    return undefined;
  }

  const match = imageId.match(/\/instances\/([^/]+)/);
  return match?.[1];
}

/**
 * Finds the slice location of a measurement within its display set.
 *
 * Returns `undefined` when the measurement cannot be tied to a specific image — a 3D
 * (SCOORD3D) annotation with no referenced image, or an instance missing from the
 * display set. Such measurements are grouped separately rather than guessed at.
 */
export default function getMeasurementSliceIndex(
  measurement: MeasurementLike,
  displaySet: DisplaySetLike
): MeasurementSliceLocation | undefined {
  const instances = displaySet?.instances || displaySet?.images;

  if (!instances?.length) {
    return undefined;
  }

  const SOPInstanceUID =
    measurement?.SOPInstanceUID ||
    getSOPInstanceUIDFromImageId(
      measurement?.referencedImageId || measurement?.metadata?.referencedImageId
    );

  if (!SOPInstanceUID) {
    return undefined;
  }

  const instanceIndex = instances.findIndex(
    instance => instance?.SOPInstanceUID === SOPInstanceUID
  );

  if (instanceIndex === -1) {
    return undefined;
  }

  const frameNumber = measurement?.frameNumber || 1;

  // Multi-frame instances contribute one image per frame, so the flat image index has to
  // account for every frame contributed by the preceding instances. This mirrors how
  // `getImageIdsForDisplaySet` expands instances into imageIds.
  const precedingImages = instances
    .slice(0, instanceIndex)
    .reduce((total, instance) => total + (instance?.NumberOfFrames || 1), 0);

  const imageIndex = precedingImages + (frameNumber - 1);

  return {
    imageIndex,
    sliceNumber: imageIndex + 1,
    frameNumber,
  };
}
