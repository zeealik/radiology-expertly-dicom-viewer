import { isAnnotationTool, isEvaluationResultAccess, isReadOnlyViewerAccess } from './studyParams';

describe('isAnnotationTool', () => {
  it('matches the measurement tools registered in the evaluation tool group', () => {
    [
      'Length',
      'ArrowAnnotate',
      'Bidirectional',
      'Probe',
      'DragProbe',
      'EllipticalROI',
      'CircleROI',
      'RectangleROI',
      'Angle',
      'CobbAngle',
      'PlanarFreehandROI',
      'SplineROI',
      'LivewireContour',
    ].forEach(toolName => {
      expect(isAnnotationTool(toolName)).toBe(true);
    });
  });

  it('matches the SR variants used to render a hydrated structured report', () => {
    ['SRLength', 'SRArrowAnnotate', 'SRBidirectional', 'SREllipticalROI', 'SRCircleROI'].forEach(
      toolName => {
        expect(isAnnotationTool(toolName)).toBe(true);
      }
    );
  });

  it('matches the DICOMSRDisplay tool that draws the SR overlay', () => {
    expect(isAnnotationTool('DICOMSRDisplay')).toBe(true);
  });

  it('does not match navigation or non-annotation tools', () => {
    ['Pan', 'Zoom', 'WindowLevel', 'StackScroll', 'Crosshairs', 'ReferenceLines', 'Magnify'].forEach(
      toolName => {
        expect(isAnnotationTool(toolName)).toBe(false);
      }
    );
  });

  it('handles non-string input safely', () => {
    expect(isAnnotationTool(undefined as unknown as string)).toBe(false);
  });
});

describe('evaluation result access', () => {
  it('detects the result viewer launch produced by the backend', () => {
    const search = '?StudyInstanceUIDs=1.2.3&dicomAccess=evaluation-result&readOnly=1';
    expect(isEvaluationResultAccess(search)).toBe(true);
    expect(isReadOnlyViewerAccess(search)).toBe(true);
  });
});
