import React, { useCallback, useEffect, useRef, useState } from 'react';
import HeadTrackingOverlay from './HeadTrackingOverlay';

const CALIB_STORAGE_PREFIX = 'ohif.gazeCalibration:';
const CALIB_EVENT = 'ohif-gaze-calibration';

// EyeGestures runs its own calibration loop and emits points flagged
// `calibration: true`. When it finishes it switches to real tracking
// (`calibration: false` / status 'connected'). We drive our overlay off those
// signals rather than imposing our own targets.
const NO_SIGNAL_TIMEOUT_MS = 12000; // no calibration signal at all => failed
const TRACKING_CONFIRM_SAMPLES = 5; // live (non-calibration) samples to confirm success
const GRACE_PERIOD_MS = 2500; // min wait before tracking-only completion is accepted
// EyeGestures Lite default calibration uses a fixed number of points; used only
// to render a smooth progress bar.
const ESTIMATED_CALIBRATION_POINTS = 25;

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
  children: React.ReactNode;
};

function GazeCalibrationGate({
  studyInstanceUIDs,
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

  // re-evaluate when the study changes
  useEffect(() => {
    setPhase(isCalibratedInSession(studyInstanceUIDs) ? 'success' : 'intro');
    setProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setFailureMessage('');
    setProgress(0);
    calibrationSamplesRef.current = 0;
    trackingSamplesRef.current = 0;
    sawCalibrationRef.current = false;
    setPhase('calibrating');

    try {
      window.OHIFEyeGesturesClient?.setCalibrationUiVisible?.(true);
      window.OHIFEyeGesturesClient?.connect?.();
      window.OHIFEyeGesturesClient?.recalibrate?.();
    } catch {
      // failures surface via the no-signal timeout
    }
  }, []);

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

    // Give recalibration a moment to begin before we accept tracking-only
    // samples as completion, so the user actually gets the visible dot loop
    // rather than skipping straight through if EyeGestures was already connected.
    let graceElapsed = false;
    const graceTimer = window.setTimeout(() => {
      graceElapsed = true;
    }, GRACE_PERIOD_MS);

    const handleGaze = (event: Event) => {
      const record = (event as CustomEvent<{ calibration?: boolean }>).detail;
      if (!record) {
        return;
      }

      if (record.calibration === true) {
        sawCalibrationRef.current = true;
        calibrationSamplesRef.current += 1;
        // a fresh calibration run resets the tracking-completion counter
        trackingSamplesRef.current = 0;
        setProgress(
          Math.min(calibrationSamplesRef.current / ESTIMATED_CALIBRATION_POINTS, 0.95)
        );
      } else {
        // Real (non-calibration) tracking samples => calibration has finished.
        trackingSamplesRef.current += 1;
        setProgress(1);
        // Complete once tracking is sustained, but only after either the grace
        // period (in case it was already connected) or a real calibration run.
        if (
          trackingSamplesRef.current >= TRACKING_CONFIRM_SAMPLES &&
          (sawCalibrationRef.current || graceElapsed)
        ) {
          finishCalibration();
        }
      }
    };

    window.addEventListener('ohif-eyegestures-status', handleStatus);
    window.addEventListener('ohif-eyegestures-gaze', handleGaze);

    const noSignalTimer = window.setTimeout(() => {
      const sawAnySignal =
        sawCalibrationRef.current || trackingSamplesRef.current > 0;
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
      window.clearTimeout(graceTimer);
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
            : 'items-center bg-black/85'
        }`}
      >
        <div className="bg-muted/80 border-input pointer-events-auto relative z-10 mx-4 max-w-md rounded-lg border p-8 text-center backdrop-blur">
          {phase === 'intro' && (
            <>
              <h2 className="text-foreground text-xl font-semibold">Eye calibration required</h2>
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                Before reviewing this study we need to calibrate eye tracking. A moving dot will
                appear on screen — follow it with your eyes. Keep your head still and your face
                well lit.
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
  };
}

export default GazeCalibrationGate;
