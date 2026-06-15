import { useEffect, useState } from 'react';
import { UNKNOWN_STATE, type HeadTrackingState } from './headTrackingMath';

const EVENT = 'ohif-head-tracking';

/**
 * Reactive view of the latest head-tracking state. Defaults to UNKNOWN_STATE
 * (inSafeZone: true) so consumers never pause gaze capture before the first
 * event arrives or when head tracking is unavailable (soft-fail).
 */
export function useHeadTrackingStatus(): HeadTrackingState {
  const [state, setState] = useState<HeadTrackingState>(
    () => window.OHIFHeadTracking?.getState?.() ?? UNKNOWN_STATE
  );

  useEffect(() => {
    const handler = (event: Event) => {
      setState((event as CustomEvent<HeadTrackingState>).detail);
    };

    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  return state;
}
