import React, { useEffect, useRef, useState } from 'react';
import { useHeadTrackingStatus } from './useHeadTrackingStatus';
import { calibKey } from './GazeCalibrationGate';
import type { HeadDirection } from './headTrackingMath';

const PREVIEW_STORAGE_KEY = 'ohif.headTracking.preview';
const SOUND_STORAGE_KEY = 'ohif.headTracking.sound';
const CALIB_EVENT = 'ohif-gaze-calibration';

// conservative smart re-calibration thresholds
const RECAL_OUT_OF_POSITION_MS = 25000;
const RECAL_FACE_LOST_MS = 15000;
const RECAL_LOW_CONF_MS = 30000;

const ARROW_GLYPH: Record<Exclude<HeadDirection, null>, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  forward: '⊕', // move closer
  back: '⊖', // lean back
  center: '◎',
};

function getBooleanPref(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function setBooleanPref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.66) {
    return 'bg-green-500';
  }
  if (confidence >= 0.33) {
    return 'bg-yellow-500';
  }
  return 'bg-red-500';
}

function playBeep() {
  try {
    const AudioCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      return;
    }
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.setTimeout(() => {
      osc.stop();
      ctx.close().catch(() => undefined);
    }, 120);
  } catch {
    // ignore
  }
}

type HeadTrackingOverlayProps = {
  studyInstanceUIDs: string[];
};

function HeadTrackingOverlay({ studyInstanceUIDs }: HeadTrackingOverlayProps): React.ReactElement | null {
  const head = useHeadTrackingStatus();
  const [previewOn, setPreviewOn] = useState(() => getBooleanPref(PREVIEW_STORAGE_KEY, false));
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const prevWarningRef = useRef(false);

  // re-calibration timers
  const outOfPositionSinceRef = useRef<number | null>(null);
  const faceLostSinceRef = useRef<number | null>(null);
  const lowConfSinceRef = useRef<number | null>(null);
  const recalFiredRef = useRef(false);

  // audio cue on entering a warning state
  useEffect(() => {
    if (head.warning && !prevWarningRef.current && getBooleanPref(SOUND_STORAGE_KEY, false)) {
      playBeep();
    }
    prevWarningRef.current = head.warning;
  }, [head.warning]);

  // bind the live preview to the head-tracker's webcam stream
  useEffect(() => {
    if (!previewOn) {
      return;
    }
    const sourceVideo = window.OHIFHeadTracking?.getVideo?.();
    const stream = (sourceVideo?.srcObject as MediaStream | null) ?? null;
    if (previewRef.current && stream) {
      previewRef.current.srcObject = stream;
      previewRef.current.play().catch(() => undefined);
    }
  }, [previewOn, head.status]);

  // smart re-calibration triggers
  useEffect(() => {
    const now = Date.now();

    const track = (active: boolean, ref: React.MutableRefObject<number | null>, limit: number) => {
      if (!active) {
        ref.current = null;
        return false;
      }
      if (ref.current === null) {
        ref.current = now;
        return false;
      }
      return now - ref.current >= limit;
    };

    const outTooLong = track(head.warning, outOfPositionSinceRef, RECAL_OUT_OF_POSITION_MS);
    const faceLostTooLong = track(head.status === 'face-lost', faceLostSinceRef, RECAL_FACE_LOST_MS);
    const lowConfTooLong = track(
      head.status !== 'unknown' && head.confidence < 0.33,
      lowConfSinceRef,
      RECAL_LOW_CONF_MS
    );

    if (head.status === 'ok') {
      recalFiredRef.current = false;
    }

    if ((outTooLong || faceLostTooLong || lowConfTooLong) && !recalFiredRef.current) {
      recalFiredRef.current = true;
      const studyKey = calibKey(studyInstanceUIDs);
      try {
        window.sessionStorage.removeItem(studyKey);
      } catch {
        // ignore
      }
      window.dispatchEvent(
        new CustomEvent(CALIB_EVENT, { detail: { status: 'reset', studyKey } })
      );
    }
  }, [head.status, head.warning, head.confidence, studyInstanceUIDs]);

  const togglePreview = () => {
    setPreviewOn(prev => {
      const next = !prev;
      setBooleanPref(PREVIEW_STORAGE_KEY, next);
      return next;
    });
  };

  const showBanner = head.warning;
  const direction = head.direction;

  return (
    <>
      {/* warning banner + directional guidance */}
      {showBanner && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[1100] -translate-x-1/2">
          <div className="bg-background/95 border-input flex items-center gap-3 rounded-lg border px-5 py-3 shadow-lg backdrop-blur">
            {direction && (
              <span
                className="text-primary-main animate-pulse text-2xl leading-none"
                aria-hidden="true"
              >
                {ARROW_GLYPH[direction]}
              </span>
            )}
            <span className="text-foreground text-sm font-medium">{head.message}</span>
          </div>
        </div>
      )}

      {/* tracking confidence dot */}
      <div className="pointer-events-none fixed bottom-4 left-4 z-[1100] flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${confidenceColor(head.confidence)}`}
          title={`Tracking confidence: ${Math.round(head.confidence * 100)}%`}
          aria-hidden="true"
        />
      </div>

      {/* preview toggle + optional PiP */}
      <button
        type="button"
        onClick={togglePreview}
        className="bg-background/90 border-input text-muted-foreground hover:text-foreground fixed bottom-4 right-4 z-[1100] rounded border px-2 py-1 text-xs"
      >
        {previewOn ? 'Hide camera' : 'Show camera'}
      </button>

      {previewOn && (
        <video
          ref={previewRef}
          muted
          playsInline
          autoPlay
          className="border-input fixed bottom-12 right-4 z-[1100] w-40 rounded border shadow-lg"
          aria-hidden="true"
        />
      )}
    </>
  );
}

export default HeadTrackingOverlay;
