/**
 * Parse StudyInstanceUIDs from the current URL query string. Supports repeated
 * params and comma-separated values, returning a de-duped, order-stable list.
 */
export function getStudyInstanceUIDs(search: string = window.location.search): string[] {
  try {
    const params = new URLSearchParams(search);
    const uids = params.getAll('StudyInstanceUIDs');

    if (uids.length) {
      return [...new Set(uids.flatMap(value => value.split(',')).filter(Boolean))];
    }
  } catch {
    // ignore
  }

  return [];
}

export function getDicomAccessMode(search: string = window.location.search): string | null {
  try {
    const params = new URLSearchParams(search);
    return params.get('dicomAccess') || params.get('dicomaccess');
  } catch {
    return null;
  }
}

export function isReadOnlyViewerAccess(search: string = window.location.search): boolean {
  try {
    const params = new URLSearchParams(search);
    const value = params.get('readOnly') || params.get('readonly');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

export function isEvaluationAdminAccess(search: string = window.location.search): boolean {
  return getDicomAccessMode(search) === 'evaluation-admin';
}

export function isEvaluationAttemptAccess(search: string = window.location.search): boolean {
  return getDicomAccessMode(search) === 'evaluation-attempt';
}

export function isEvaluationResultAccess(search: string = window.location.search): boolean {
  return getDicomAccessMode(search) === 'evaluation-result';
}

/**
 * Tools that draw measurement/annotation graphics onto the image, including the
 * `SR*` variants and `DICOMSRDisplay` used to render a hydrated Structured Report.
 *
 * Cornerstone3D's AnnotationRenderingEngine only draws annotations for tools in
 * Active/Passive/Enabled mode, so in a read-only viewer these must be set to
 * `Enabled` (renders, non-interactive) rather than `Disabled` (renders nothing).
 */
const ANNOTATION_TOOL_PATTERN =
  /^(SR)?(Length|ArrowAnnotate|Bidirectional|Probe|DragProbe|EllipticalROI|CircleROI|RectangleROI|Angle|CobbAngle|PlanarFreehandROI|SplineROI|LivewireContour|UltrasoundDirectional|CalibrationLine|PlanarFreehandContourSegmentation|SegmentBidirectional)$|DICOMSRDisplay/i;

export function isAnnotationTool(toolName: string): boolean {
  return typeof toolName === 'string' && ANNOTATION_TOOL_PATTERN.test(toolName);
}
