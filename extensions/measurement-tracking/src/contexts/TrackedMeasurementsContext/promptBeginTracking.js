const RESPONSE = {
  NO_NEVER: -1,
  SET_STUDY_AND_SERIES: 3,
};

export const measurementTrackingMode = {
  STANDARD: 'standard',
  SIMPLIFIED: 'simplified',
  NONE: 'none',
};

function promptBeginTracking({ extensionManager }, _ctx, evt) {
  const appConfig = extensionManager.appConfig;
  // When the state change happens after a promise, the state machine sends the retult in evt.data;
  // In case of direct transition to the state, the state machine sends the data in evt;
  const { viewportId, StudyInstanceUID, SeriesInstanceUID } = evt.data || evt;

  const noTrackingMode = appConfig?.measurementTrackingMode === measurementTrackingMode.NONE;

  return Promise.resolve({
    userResponse: noTrackingMode ? RESPONSE.NO_NEVER : RESPONSE.SET_STUDY_AND_SERIES,
    StudyInstanceUID,
    SeriesInstanceUID,
    viewportId,
  });
}

export default promptBeginTracking;
