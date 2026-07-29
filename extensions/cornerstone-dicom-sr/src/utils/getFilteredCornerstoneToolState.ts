import { annotation } from '@cornerstonejs/tools';
import { NO_IMAGE_ID } from '@cornerstonejs/adapters';

function getFilteredCornerstoneToolState(measurementData, additionalFindingTypes) {
  const filteredToolState = {};
  const measurementsByUid = new Map(
    measurementData.map(measurement => [measurement.uid, measurement])
  );

  function addToFilteredToolState(annotation, toolType) {
    const measurementDataI = measurementsByUid.get(annotation.annotationUID);

    if (!measurementDataI) {
      return;
    }

    const imageId =
      annotation.metadata?.referencedImageId ??
      measurementDataI?.referencedImageId ??
      NO_IMAGE_ID;

    annotation = normalizeAnnotationForExport(annotation, measurementDataI, imageId);

    if (!filteredToolState[imageId]) {
      filteredToolState[imageId] = {};
    }

    const imageIdSpecificToolState = filteredToolState[imageId];

    if (!imageIdSpecificToolState[toolType]) {
      imageIdSpecificToolState[toolType] = {
        data: [],
      };
    }

    const toolData = imageIdSpecificToolState[toolType].data;

    let { finding } = measurementDataI;
    const findingSites = [];

    // NOTE -> We use the CORNERSTONEJS coding schemeDesignator which we have
    // defined in the @cornerstonejs/adapters
    if (measurementDataI.label) {
      if (additionalFindingTypes.includes(toolType)) {
        finding = {
          CodeValue: 'CORNERSTONEFREETEXT',
          CodingSchemeDesignator: 'CORNERSTONEJS',
          CodeMeaning: measurementDataI.label,
        };
      } else {
        findingSites.push({
          CodeValue: 'CORNERSTONEFREETEXT',
          CodingSchemeDesignator: 'CORNERSTONEJS',
          CodeMeaning: measurementDataI.label,
        });
      }
    }

    if (measurementDataI.findingSites) {
      findingSites.push(...measurementDataI.findingSites);
    }

    const measurement = Object.assign({}, annotation, {
      finding,
      findingSites,
    });

    toolData.push(measurement);
  }

  const uidFilter = measurementData.map(md => md.uid);
  const uids = uidFilter.slice();

  const annotationManager = annotation.state.getAnnotationManager();
  const framesOfReference = annotationManager.getFramesOfReference();

  for (let i = 0; i < framesOfReference.length; i++) {
    const frameOfReference = framesOfReference[i];

    const frameOfReferenceAnnotations = annotationManager.getAnnotations(frameOfReference);

    const toolTypes = Object.keys(frameOfReferenceAnnotations);

    for (let j = 0; j < toolTypes.length; j++) {
      const toolType = toolTypes[j];

      const annotations = frameOfReferenceAnnotations[toolType];

      if (annotations) {
        for (let k = 0; k < annotations.length; k++) {
          const annotation = annotations[k];
          const uidIndex = uids.findIndex(uid => uid === annotation.annotationUID);

          if (uidIndex !== -1) {
            addToFilteredToolState(annotation, toolType);
            uids.splice(uidIndex, 1);

            if (!uids.length) {
              return filteredToolState;
            }
          }
        }
      }
    }
  }

  return filteredToolState;
}

function normalizeAnnotationForExport(annotation, measurementDataI, imageId) {
  const referencedImageId = imageId === NO_IMAGE_ID ? undefined : imageId;

  return {
    ...annotation,
    predecessorImageId: annotation.predecessorImageId ?? measurementDataI.predecessorImageId,
    metadata: {
      ...measurementDataI.metadata,
      ...annotation.metadata,
      FrameOfReferenceUID:
        annotation.metadata?.FrameOfReferenceUID ?? measurementDataI.FrameOfReferenceUID,
      referencedImageId,
    },
  };
}

export default getFilteredCornerstoneToolState;
