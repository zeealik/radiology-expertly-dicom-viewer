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
    return new URLSearchParams(search).get('dicomAccess');
  } catch {
    return null;
  }
}

export function isEvaluationAdminAccess(search: string = window.location.search): boolean {
  return getDicomAccessMode(search) === 'evaluation-admin';
}
