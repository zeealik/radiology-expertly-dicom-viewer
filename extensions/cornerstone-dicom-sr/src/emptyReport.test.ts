import { adaptersSR } from '@cornerstonejs/adapters';

const { MeasurementReport } = adaptersSR.Cornerstone3D;

/**
 * Guards the contract that lets a study be saved with no findings on it.
 *
 * `_generateReport` keys an empty report's tool state on the image the user was looking at, and
 * these tests pin down why that is load-bearing: the adapter collects an SR's derivation source
 * datasets while walking referenced images, and dcmjs reads `derivationSourceDatasets[0]` when
 * constructing the report. With no referenced image at all there is nothing to derive from.
 */

const REFERENCED_IMAGE_ID = 'wadors:https://example.org/studies/1.2.3/frames/1';

const SOP_INSTANCE_UID = '1.2.826.0.1.3680043.8.498.1';
const SERIES_INSTANCE_UID = '1.2.826.0.1.3680043.8.498.2';
const STUDY_INSTANCE_UID = '1.2.826.0.1.3680043.8.498.3';

const metadataProvider = {
  get(module: string) {
    if (module === 'sopCommonModule') {
      return { sopInstanceUID: SOP_INSTANCE_UID, sopClassUID: '1.2.840.10008.5.1.4.1.1.6.1' };
    }

    if (module === 'instance') {
      return {
        SOPInstanceUID: SOP_INSTANCE_UID,
        SOPClassUID: '1.2.840.10008.5.1.4.1.1.6.1',
        SeriesInstanceUID: SERIES_INSTANCE_UID,
        StudyInstanceUID: STUDY_INSTANCE_UID,
        SeriesNumber: 1,
        InstanceNumber: 1,
        Modality: 'US',
      };
    }

    if (module === 'frameNumber') {
      return 1;
    }

    return undefined;
  },
};

describe('generating a report with no measurements', () => {
  it('cannot build an SR when nothing references an image', () => {
    // This is the failure the "Add at least one annotation" guard was really standing in front
    // of: an SR is a derived object, so it cannot be built from an empty tool state.
    expect(() => MeasurementReport.generateReport({}, metadataProvider, {})).toThrow();
  });

  it('builds an SR when the reviewed image is named, even with no annotations', () => {
    const report = MeasurementReport.generateReport(
      { [REFERENCED_IMAGE_ID]: {} },
      metadataProvider,
      {}
    );

    expect(report.dataset).toBeTruthy();
    expect(report.dataset.SOPClassUID).toBeTruthy();
  });

  it('records no measurement groups, so the study reads as reviewed with no findings', () => {
    const report = MeasurementReport.generateReport(
      { [REFERENCED_IMAGE_ID]: {} },
      metadataProvider,
      {}
    );

    // `ContentSequence[4]` is where the adapter puts imaging measurements; an empty save must
    // leave it empty rather than inventing a finding.
    const imagingMeasurements = report.dataset.ContentSequence?.[4]?.ContentSequence;

    expect(imagingMeasurements?.length ?? 0).toBe(0);
  });

  it('still points at the study it was reviewed against', () => {
    const report = MeasurementReport.generateReport(
      { [REFERENCED_IMAGE_ID]: {} },
      metadataProvider,
      {}
    );

    // The SR inherits the study from its derivation source, which is what makes an empty save
    // findable against the right study rather than an orphan record.
    expect(report.dataset.StudyInstanceUID).toBe(STUDY_INSTANCE_UID);
    expect(report.dataset.Modality).toBe('SR');
  });
});
