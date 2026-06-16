import React, { useCallback, useEffect, useRef, useState } from 'react';
import HeadTrackingOverlay from './HeadTrackingOverlay';

const CALIB_STORAGE_PREFIX = 'ohif.gazeCalibration:';
const CALIB_EVENT = 'ohif-gaze-calibration';

// EyeGestures runs its own calibration loop and emits points flagged
// `calibration: true`. When it finishes it switches to real tracking
// (`calibration: false` / status 'connected'). We drive our overlay off those
// signals rather than imposing our own targets.
const NO_SIGNAL_TIMEOUT_MS = 12000; // no calibration signal at all => failed
// The user must visibly follow every calibration circle before we accept that
// calibration is complete. EyeGestures shows a fixed grid of circles, one at a
// time; we count the distinct target positions it moves the dot to and refuse
// to finish until all of them have been followed. Without this guard the gate
// completes after the very first circle as soon as a stray tracking sample
// arrives.
const REQUIRED_CALIBRATION_CIRCLES = 9;
// Two circles are treated as the same target when their centres fall within
// this many pixels of each other, absorbing the sub-pixel jitter the library
// applies to the dot position each frame.
const CIRCLE_MATCH_TOLERANCE_PX = 40;
// Safety valve: if the library ever ships a grid with fewer than the required
// circles, don't hang forever. After this many sustained real-tracking samples
// following at least one calibration circle, accept completion anyway.
const TRACKING_FALLBACK_SAMPLES = 60;
// Once all circles are followed, wait this long before switching to the study so
// the final reading settles and the user sees the "complete" state briefly.
const COMPLETION_SETTLE_MS = 600;

type CalibrationPhase = 'intro' | 'calibrating' | 'success' | 'failed';

type EyeGesturesStatusDetail = {
  status?: 'connected' | 'disconnected' | 'waiting' | 'calibrating';
  message?: string;
};

export function calibKey(uids: string[]): string {
  return CALIB_STORAGE_PREFIX + [...uids].filter(Boolean).sort().join(',');
}

function isCalibratedInSession(uids: string[]): boolean {
  try {
    return window.sessionStorage.getItem(calibKey(uids)) === 'done';
  } catch {
    return false;
  }
}

function clearCalibrated(uids: string[], reason = 'reset') {
  const key = calibKey(uids);

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }

  window.dispatchEvent(
    new CustomEvent(CALIB_EVENT, {
      detail: { status: reason, studyKey: key },
    })
  );
}

function markCalibrated(uids: string[]) {
  const key = calibKey(uids);

  try {
    window.sessionStorage.setItem(key, 'done');
  } catch {
    // ignore
  }

  window.dispatchEvent(
    new CustomEvent(CALIB_EVENT, {
      detail: { status: 'done', studyKey: key },
    })
  );
}

// Start head tracking and anchor its safe zone to the just-calibrated posture.
// Fully soft — never throws, never blocks the study if the camera/model is down.
function anchorHeadTrackingBaseline() {
  void (async () => {
    try {
      await window.OHIFHeadTracking?.start?.();
      window.setTimeout(() => {
        try {
          window.OHIFHeadTracking?.captureBaseline?.();
        } catch {
          // ignore
        }
      }, 800);
    } catch {
      // ignore
    }
  })();
}

declare global {
  interface Window {
    OHIFGazeCalibration?: {
      isCalibrated: (uids: string[]) => boolean;
      reset: (uids: string[], reason?: string) => void;
      recalibrate: (uids: string[]) => void;
    };
    OHIFEyeGesturesClient?: {
      connect: () => void;
      recalibrate?: () => void;
      getStatus?: () => string;
      setCalibrationUiVisible?: (visible: boolean) => void;
    };
  }
}

/**
 * Reactive view of whether the current study has completed gaze calibration this
 * session. Used to gate gaze capture in the viewport.
 */
export function useGazeCalibrationStatus(uids: string[]): boolean {
  const key = calibKey(uids);
  const [calibrated, setCalibrated] = useState(() => isCalibratedInSession(uids));

  useEffect(() => {
    setCalibrated(isCalibratedInSession(uids));

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ studyKey?: string }>).detail;
      if (!detail?.studyKey || detail.studyKey === key) {
        setCalibrated(isCalibratedInSession(uids));
      }
    };

    window.addEventListener(CALIB_EVENT, handler);
    return () => window.removeEventListener(CALIB_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return calibrated;
}

type GazeCalibrationGateProps = {
  studyInstanceUIDs: string[];
  calibrationSessionId?: string;
  children: React.ReactNode;
};

function GazeCalibrationGate({
  studyInstanceUIDs,
  calibrationSessionId,
  children,
}: GazeCalibrationGateProps): React.ReactElement {
  const key = calibKey(studyInstanceUIDs);
  const [phase, setPhase] = useState<CalibrationPhase>(() =>
    isCalibratedInSession(studyInstanceUIDs) ? 'success' : 'intro'
  );
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [failureMessage, setFailureMessage] = useState<string>('');

  const calibrationSamplesRef = useRef(0);
  const trackingSamplesRef = useRef(0);
  const sawCalibrationRef = useRef(false);
  // Distinct calibration circles the user has followed so far this run. Each
  // entry is the centre of one target; completion is blocked until this reaches
  // REQUIRED_CALIBRATION_CIRCLES.
  const visitedCirclesRef = useRef<Array<{ x: number; y: number }>>([]);
  const completionTimerRef = useRef<number | undefined>();
  const lastCalibrationSessionIdRef = useRef<string | undefined>();

  // Each viewer entry starts with a fresh gaze posture. Do not reuse a stale
  // calibration from a previous study-reading session.
  useEffect(() => {
    if (!calibrationSessionId || lastCalibrationSessionIdRef.current === calibrationSessionId) {
      return;
    }

    lastCalibrationSessionIdRef.current = calibrationSessionId;
    clearCalibrated(studyInstanceUIDs, 'new-session');
    setFailureMessage('');
    setStatusMessage('');
    setProgress(0);
    setPhase('intro');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrationSessionId]);

  // re-evaluate when the study changes
  useEffect(() => {
    setPhase(isCalibratedInSession(studyInstanceUIDs) ? 'success' : 'intro');
    setProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Smart head-tracking reset and manual reset events must bring the prompt
  // back even after the gate has already reached success.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; studyKey?: string }>).detail;

      if (detail?.studyKey && detail.studyKey !== key) {
        return;
      }

      if (detail?.status === 'done') {
        setPhase('success');
        return;
      }

      setFailureMessage('');
      setProgress(0);
      setStatusMessage(
        detail?.status === 'new-session'
          ? ''
          : 'Head position changed enough to affect gaze accuracy. Please recalibrate before continuing.'
      );
      setPhase('intro');
    };

    window.addEventListener(CALIB_EVENT, handler);
    return () => window.removeEventListener(CALIB_EVENT, handler);
  }, [key]);

  const finishCalibration = useCallback(() => {
    try {
      window.OHIFEyeGesturesClient?.setCalibrationUiVisible?.(false);
    } catch {
      // ignore
    }
    markCalibrated(studyInstanceUIDs);
    // Anchor the head-tracking safe zone to the posture used during calibration.
    anchorHeadTrackingBaseline();
    setPhase('success');
  }, [studyInstanceUIDs]);

  // Already calibrated on mount (reload / re-entry): still anchor a baseline.
  useEffect(() => {
    if (isCalibratedInSession(studyInstanceUIDs)) {
      anchorHeadTrackingBaseline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const failCalibration = useCallback((message: string) => {
    try {
      window.OHIFEyeGesturesClient?.setCalibrationUiVisible?.(false);
    } catch {
      // ignore
    }
    setFailureMessage(message);
    setPhase('failed');
  }, []);

  const startCalibration = useCallback(() => {
    clearCalibrated(studyInstanceUIDs, 'recalibrating');
    setFailureMessage('');
    setStatusMessage('');
    setProgress(0);
    calibrationSamplesRef.current = 0;
    trackingSamplesRef.current = 0;
    sawCalibrationRef.current = false;
    visitedCirclesRef.current = [];
    if (completionTimerRef.current !== undefined) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = undefined;
    }
    setPhase('calibrating');

    try {
      window.OHIFEyeGesturesClient?.setCalibrationUiVisible?.(true);
      window.OHIFEyeGesturesClient?.connect?.();
      window.OHIFEyeGesturesClient?.recalibrate?.();
    } catch {
      // failures surface via the no-signal timeout
    }
  }, [studyInstanceUIDs]);

  // drive the overlay off EyeGestures' calibration + tracking signals
  useEffect(() => {
    if (phase !== 'calibrating') {
      return;
    }

    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<EyeGesturesStatusDetail>).detail;
      if (detail?.message) {
        setStatusMessage(detail.message);
      }
    };

    const allCirclesFollowed = () =>
      visitedCirclesRef.current.length >= REQUIRED_CALIBRATION_CIRCLES;

    // Once the user has followed all required circles, calibration is done. We
    // can't rely on the library emitting a clean run of real-tracking samples to
    // signal completion (it keeps re-showing calibration points, which resets any
    // tracking counter), so we finish on a short settle delay after the final
    // circle. completing guards against scheduling it more than once.
    let completing = false;
    const completeAfterAllCircles = () => {
      if (completing) {
        return;
      }
      completing = true;
      setProgress(1);
      setStatusMessage('Calibration complete.');
      completionTimerRef.current = window.setTimeout(() => {
        finishCalibration();
      }, COMPLETION_SETTLE_MS);
    };

    // Record the circle currently being shown. Returns true when it is a new,
    // not-yet-followed target so we can advance progress one circle at a time.
    const noteCircle = (tx?: number, ty?: number): boolean => {
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
        return false;
      }

      const isNew = !visitedCirclesRef.current.some(
        circle =>
          Math.hypot(circle.x - (tx as number), circle.y - (ty as number)) <=
          CIRCLE_MATCH_TOLERANCE_PX
      );

      if (isNew) {
        visitedCirclesRef.current.push({ x: tx as number, y: ty as number });
      }

      return isNew;
    };

    const handleGaze = (event: Event) => {
      const record = (
        event as CustomEvent<{
          calibration?: boolean;
          targetX?: number;
          targetY?: number;
        }>
      ).detail;
      if (!record) {
        return;
      }

      if (record.calibration === true) {
        sawCalibrationRef.current = true;
        calibrationSamplesRef.current += 1;
        // a fresh calibration run resets the tracking-completion counter
        trackingSamplesRef.current = 0;
        noteCircle(record.targetX, record.targetY);
        const circlesDone = Math.min(
          visitedCirclesRef.current.length,
          REQUIRED_CALIBRATION_CIRCLES
        );

        if (allCirclesFollowed()) {
          // Every circle followed — finish even if the library keeps cycling.
          completeAfterAllCircles();
          return;
        }

        // Progress reflects how many of the required circles have been followed.
        setProgress(Math.min(circlesDone / REQUIRED_CALIBRATION_CIRCLES, 0.95));
        setStatusMessage(
          `Follow the dot — circle ${circlesDone} of ${REQUIRED_CALIBRATION_CIRCLES}.`
        );
      } else {
        // Real (non-calibration) tracking samples => the library has switched to
        // live tracking. Accept as completion only once every circle has been
        // followed; otherwise an early stray sample would end calibration after
        // the first dot.
        trackingSamplesRef.current += 1;

        const fallback =
          sawCalibrationRef.current &&
          trackingSamplesRef.current >= TRACKING_FALLBACK_SAMPLES;

        if (allCirclesFollowed() || fallback) {
          completeAfterAllCircles();
        }
      }
    };

    window.addEventListener('ohif-eyegestures-status', handleStatus);
    window.addEventListener('ohif-eyegestures-gaze', handleGaze);

    const noSignalTimer = window.setTimeout(() => {
      const sawAnySignal = sawCalibrationRef.current || trackingSamplesRef.current > 0;
      if (!sawAnySignal) {
        failCalibration(
          'No eye-tracking signal detected. Check that your webcam is connected and camera access is allowed, then try again.'
        );
      }
    }, NO_SIGNAL_TIMEOUT_MS);

    return () => {
      window.removeEventListener('ohif-eyegestures-status', handleStatus);
      window.removeEventListener('ohif-eyegestures-gaze', handleGaze);
      window.clearTimeout(noSignalTimer);
      if (completionTimerRef.current !== undefined) {
        window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = undefined;
      }
    };
  }, [phase, failCalibration, finishCalibration]);

  if (phase === 'success') {
    return (
      <>
        {children}
        <HeadTrackingOverlay studyInstanceUIDs={studyInstanceUIDs} />
      </>
    );
  }

  // During active calibration we must NOT cover the screen, otherwise
  // EyeGestures' own moving target dot (rendered in the page) is hidden behind
  // our backdrop. We dim only lightly and keep the instruction card out of the
  // center so the dot stays visible everywhere.
  const isCalibrating = phase === 'calibrating';

  return (
    <>
      {children}
      <div
        className={`fixed inset-0 z-[1000] flex justify-center ${
          isCalibrating
            ? 'pointer-events-none items-end bg-black/30 pb-10'
            : 'bg-black/85 items-center'
        }`}
      >
        <div className="bg-muted/80 border-input pointer-events-auto relative z-10 mx-4 max-w-md rounded-lg border p-8 text-center backdrop-blur">
          {phase === 'intro' && (
            <>
              <h2 className="text-foreground text-xl font-semibold">Eye calibration required</h2>
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                Before reviewing this study we need to calibrate eye tracking. A dot will appear at
                nine positions across the screen — follow each one with your eyes until all nine are
                done. Keep your head still and your face well lit.
              </p>
              {statusMessage && (
                <p className="text-muted-foreground mt-3 text-xs">{statusMessage}</p>
              )}
              <button
                type="button"
                onClick={startCalibration}
                className="bg-primary-main hover:bg-primary-light focus:ring-primary-main mt-6 w-full rounded px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2"
              >
                Start calibration
              </button>
            </>
          )}

          {phase === 'calibrating' && (
            <>
              <h2 className="text-foreground text-lg font-semibold">Follow the moving dot</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {statusMessage || 'Calibrating eye tracking…'}
              </p>
              <div className="bg-input mt-4 h-1.5 w-full overflow-hidden rounded">
                <div
                  className="bg-primary-main h-full transition-all duration-300"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </>
          )}

          {phase === 'failed' && (
            <>
              <h2 className="text-foreground text-xl font-semibold">Calibration failed</h2>
              <p className="text-muted-foreground mt-3 text-sm leading-6">{failureMessage}</p>
              <button
                type="button"
                onClick={startCalibration}
                className="bg-primary-main hover:bg-primary-light focus:ring-primary-main mt-6 w-full rounded px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2"
              >
                Redo calibration
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

if (typeof window !== 'undefined') {
  window.OHIFGazeCalibration = {
    isCalibrated: isCalibratedInSession,
    reset: clearCalibrated,
    recalibrate: (uids: string[]) => clearCalibrated(uids, 'manual-recalibrate'),
  };
}

export default GazeCalibrationGate;
