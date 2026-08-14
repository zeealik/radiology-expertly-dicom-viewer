import * as cornerstone from '@cornerstonejs/core';

function getDisplaySet({ imageId, metadata, displaySetService }) {
  const { volumeId, FrameOfReferenceUID, SeriesInstanceUID, StudyInstanceUID, SOPInstanceUID } =
    metadata;

  if (volumeId) {
    const displaySet = displaySetService.getDisplaySetsBy(displaySet =>
      volumeId.includes(displaySet.uid)
    )[0];
    if (displaySet) {
      return displaySet;
    }
    console.warn('Unable to find volumeId', volumeId);
    metadata.volumeId = null;
  }

  const displaySets = Array.from(displaySetService.getDisplaySetCache().values());

  if (imageId) {
    const displaySet = displaySets.find(ds => ds.images?.some(image => image.imageId === imageId));

    if (displaySet) {
      return displaySet;
    }
  }

  if (FrameOfReferenceUID) {
    const displaySet = Array.from(displaySetService.getDisplaySetCache().values()).find(
      ds =>
        ds.FrameOfReferenceUID === FrameOfReferenceUID ||
        ds.instance?.FrameOfReferenceUID === FrameOfReferenceUID ||
        ds.instances?.some(instance => instance.FrameOfReferenceUID === FrameOfReferenceUID)
    );

    if (displaySet) {
      return displaySet;
    }

    console.warn('Could not find matching displaySet for the provided FrameOfReferenceUID.');
  }

  if (SeriesInstanceUID) {
    const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)?.[0];

    if (displaySet) {
      return displaySet;
    }
  }

  if (StudyInstanceUID || SOPInstanceUID) {
    const displaySet = displaySets.find(ds => {
      const matchesStudy = !StudyInstanceUID || ds.StudyInstanceUID === StudyInstanceUID;
      const matchesSOP =
        !SOPInstanceUID ||
        ds.instances?.some(instance => instance.SOPInstanceUID === SOPInstanceUID);

      return matchesStudy && matchesSOP;
    });

    if (displaySet) {
      return displaySet;
    }
  }

  const activeDisplaySets = displaySetService.getActiveDisplaySets?.();
  if (activeDisplaySets?.length === 1) {
    return activeDisplaySets[0];
  }

  if (displaySets.length === 1) {
    return displaySets[0];
  }

  throw new Error('Could not find matching displaySet for annotation metadata.');
}

/**
 * It checks if the imageId is provided then it uses it to query
 * the metadata and get the SOPInstanceUID, SeriesInstanceUID and StudyInstanceUID.
 * If the imageId is not provided then undefined is returned.
 * @param {string} imageId The image id of the referenced image
 * @returns
 */
export default function getSOPInstanceAttributes(imageId, displaySetService, annotation) {
  if (imageId) {
    const attributes = _getUIDFromImageID(imageId);

    if (attributes.SeriesInstanceUID && attributes.StudyInstanceUID) {
      return attributes;
    }
  }

  const { metadata } = annotation;
  const displaySet = getDisplaySet({ imageId, metadata, displaySetService });
  const { StudyInstanceUID, SeriesInstanceUID } = displaySet;
  const instance =
    annotation?.metadata?.SOPInstanceUID &&
    displaySet.instances?.find(
      instance => instance.SOPInstanceUID === annotation.metadata.SOPInstanceUID
    );

  return {
    SOPInstanceUID: instance?.SOPInstanceUID || annotation?.metadata?.SOPInstanceUID,
    SeriesInstanceUID,
    StudyInstanceUID,
  };
}

function _getUIDFromImageID(imageId) {
  const instance = cornerstone.metaData.get('instance', imageId);

  if (!instance) {
    return {};
  }

  return {
    SOPInstanceUID: instance.SOPInstanceUID,
    SeriesInstanceUID: instance.SeriesInstanceUID,
    StudyInstanceUID: instance.StudyInstanceUID,
    frameNumber: instance.frameNumber || 1,
  };
}
