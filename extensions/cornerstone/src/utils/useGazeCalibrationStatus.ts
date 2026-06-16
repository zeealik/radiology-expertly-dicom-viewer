import { useEffect, useState } from 'react';

const CALIB_STORAGE_PREFIX = 'ohif.gazeCalibration:';
const CALIB_EVENT = 'ohif-gaze-calibration';

declare global {
  interface Window {
    OHIFGazeCalibration?: {
      isCalibrated: (uids: string[]) => boolean;
      reset?: (uids: string[], reason?: string) => void;
      recalibrate?: (uids: string[]) => void;
    };
  }
}

function calibKey(uids: string[]): string {
  return CALIB_STORAGE_PREFIX + [...uids].filter(Boolean).sort().join(',');
}

function readCalibrated(uids: string[]): boolean {
  if (typeof window !== 'undefined' && window.OHIFGazeCalibration) {
    return window.OHIFGazeCalibration.isCalibrated(uids);
  }

  try {
    return window.sessionStorage.getItem(calibKey(uids)) === 'done';
  } catch {
    return false;
  }
}

/**
 * Reactive view of whether the given study has completed gaze calibration this
 * session. Mirrors the hook in the default extension but lives here so the
 * cornerstone viewport has no cross-extension import dependency.
 */
export function useGazeCalibrationStatus(uids: string[]): boolean {
  const key = calibKey(uids);
  const [calibrated, setCalibrated] = useState(() => readCalibrated(uids));

  useEffect(() => {
    setCalibrated(readCalibrated(uids));

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ studyKey?: string }>).detail;
      if (!detail?.studyKey || detail.studyKey === key) {
        setCalibrated(readCalibrated(uids));
      }
    };

    window.addEventListener(CALIB_EVENT, handler);
    return () => window.removeEventListener(CALIB_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return calibrated;
}
