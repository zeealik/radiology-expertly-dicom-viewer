/** @type {AppTypes.Config} */
window.config = {
  routerBasename: null,
  extensions: [],
  modes: [],
  showStudyList: false,
  maxNumberOfWebWorkers: 3,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  strictZSpacingForVolumeViewport: true,
  evaluationDicomWebRoot: 'http://localhost:8081/dicom-web',
  defaultDataSourceName: 'evaluationOrthancProxy',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'evaluationOrthancProxy',
      configuration: {
        friendlyName: 'Evaluation Orthanc Proxy',
        name: 'Evaluation Orthanc Proxy',
        // Local users-be DICOM proxy. It validates the short-lived viewer token
        // before forwarding read requests to Orthanc at http://localhost:8042.
        wadoUriRoot: 'http://localhost:8081/dicom-web',
        qidoRoot: 'http://localhost:8081/dicom-web',
        wadoRoot: 'http://localhost:8081/dicom-web',
        qidoSupportsIncludeField: true,
        supportsReject: false,
        dicomUploadEnabled: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom json',
        name: 'json',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn(error.status);
  },
};
