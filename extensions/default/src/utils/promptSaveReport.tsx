import { utils } from '@ohif/core';

import createReportAsync from '../Actions/createReportAsync';
import { createReportDialogPrompt } from '../Panels';
import PROMPT_RESPONSES from './_shared/PROMPT_RESPONSES';

const { filterAnd, filterMeasurementsByStudyUID, filterMeasurementsBySeriesUID } =
  utils.MeasurementFilters;

const studyFindingSeriesUIDs = new Map<string, string>();
const studyFindingInstanceNumbers = new Map<string, number>();

async function promptSaveReport({ servicesManager, commandsManager, extensionManager }, ctx, evt) {
  const { measurementService, displaySetService } = servicesManager.services;
  const viewportId = evt.viewportId === undefined ? evt.data.viewportId : evt.viewportId;
  const isBackupSave = evt.isBackupSave === undefined ? evt.data.isBackupSave : evt.isBackupSave;
  const StudyInstanceUID = evt?.data?.StudyInstanceUID || ctx.trackedStudy;
  const SeriesInstanceUID = evt?.data?.SeriesInstanceUID;
  const { displaySetInstanceUID } = evt.data ?? evt;

  const {
    trackedSeries,
    measurementFilter = filterAnd(
      filterMeasurementsByStudyUID(StudyInstanceUID),
      filterMeasurementsBySeriesUID(trackedSeries)
    ),
    defaultSaveTitle = 'Study Findings',
    skipPrompt = false,
  } = ctx;
  let displaySetInstanceUIDs;

  const measurementData = measurementService.getMeasurements(measurementFilter);
  const predecessorImageId = findPredecessorImageId(measurementData);

  try {
    const promptResult = skipPrompt
      ? {
          action: PROMPT_RESPONSES.CREATE_REPORT,
          value: defaultSaveTitle,
          dataSourceName: undefined,
          series: predecessorImageId,
          priorSeriesNumber: getPriorSeriesNumber(displaySetService, 3000),
        }
      : await createReportDialogPrompt({
          title: defaultSaveTitle,
          predecessorImageId,
          minSeriesNumber: 3000,
          extensionManager,
          servicesManager,
          enableDownload: true,
          defaultValue: defaultSaveTitle,
        });

    if (promptResult.action === PROMPT_RESPONSES.CREATE_REPORT) {
      const { series, priorSeriesNumber, value: reportName, dataSourceName } = promptResult;
      const SeriesDescription = reportName || defaultSaveTitle;
      const groupedStudyFindingOptions = skipPrompt
        ? getGroupedStudyFindingOptions({
            displaySetService,
            StudyInstanceUID,
            SeriesDescription,
            priorSeriesNumber,
          })
        : {};

      const getReport = async () =>
        commandsManager.runCommand(
          'storeMeasurements',
          {
            measurementData,
            dataSource: dataSourceName,
            additionalFindingTypes: ['ArrowAnnotate'],
            options: {
              SeriesDescription,
              SeriesNumber: 1 + priorSeriesNumber,
              predecessorImageId: series,
              ...groupedStudyFindingOptions,
            },
          },
          'CORNERSTONE_STRUCTURED_REPORT'
        );

      displaySetInstanceUIDs = await createReportAsync({
        servicesManager,
        getReport,
      });
    } else if (promptResult.action === PROMPT_RESPONSES.CANCEL) {
      // Do nothing
    }

    return {
      userResponse: promptResult.action,
      createdDisplaySetInstanceUIDs: displaySetInstanceUIDs,
      StudyInstanceUID,
      SeriesInstanceUID,
      viewportId,
      isBackupSave,
      displaySetInstanceUID,
    };
  } catch (error) {
    console.warn('Unable to save report', error);
    return null;
  }
}

export function findPredecessorImageId(annotations) {
  let predecessorImageId;
  for (const annotation of annotations) {
    if (
      predecessorImageId &&
      annotation.predecessorImageId &&
      annotation.predecessorImageId !== predecessorImageId
    ) {
      console.warn('Found multiple source predecessors, not defaulting to same series');
      return;
    }
    predecessorImageId ||= annotation.predecessorImageId;
  }
  return predecessorImageId;
}

function getPriorSeriesNumber(displaySetService, minSeriesNumber) {
  const displaySetsMap = displaySetService.getDisplaySetCache();
  const displaySets = Array.from(displaySetsMap.values());
  const seriesNumbers = displaySets
    .filter(ds => ds.Modality === 'SR')
    .map(ds => (isFinite(ds.SeriesNumber) ? ds.SeriesNumber : minSeriesNumber));

  return Math.max(minSeriesNumber, ...seriesNumbers);
}

function getGroupedStudyFindingOptions({
  displaySetService,
  StudyInstanceUID,
  SeriesDescription,
  priorSeriesNumber,
}) {
  const key = `${StudyInstanceUID}:${SeriesDescription}`;
  const existingDisplaySet = findStudyFindingDisplaySet({
    displaySetService,
    StudyInstanceUID,
    SeriesDescription,
  });
  const SeriesInstanceUID =
    existingDisplaySet?.SeriesInstanceUID || studyFindingSeriesUIDs.get(key) || utils.guid();
  const existingInstanceCount = existingDisplaySet?.instances?.length || 0;
  const InstanceNumber =
    Math.max(existingInstanceCount, studyFindingInstanceNumbers.get(key) || 0) + 1;

  studyFindingSeriesUIDs.set(key, SeriesInstanceUID);
  studyFindingInstanceNumbers.set(key, InstanceNumber);

  return {
    SeriesInstanceUID,
    SeriesNumber: existingDisplaySet?.SeriesNumber || 1 + priorSeriesNumber,
    InstanceNumber,
  };
}

function findStudyFindingDisplaySet({ displaySetService, StudyInstanceUID, SeriesDescription }) {
  const displaySetsMap = displaySetService.getDisplaySetCache();
  const displaySets = Array.from(displaySetsMap.values());

  return displaySets.reverse().find(
    ds =>
      ds.Modality === 'SR' &&
      ds.StudyInstanceUID === StudyInstanceUID &&
      ds.SeriesDescription === SeriesDescription
  );
}

export default promptSaveReport;
