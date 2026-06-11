type EyeGesturesStatus = 'connected' | 'disconnected' | 'waiting' | 'calibrating';

type EyeGesturesBrowserClientOptions = {
  scriptUrl?: string;
  stylesheetUrl?: string;
};

type EyeGesturesConstructor = new (
  videoElementId: string,
  onGaze: (point: [number, number], calibration?: boolean) => void
) => {
  invisible?: () => void;
  showCalibrationInstructions?: (onRead: () => void) => void;
  start: () => void;
  stop?: () => void;
  recalibrate?: () => void;
};

declare global {
  interface Window {
    EyeGestures?: EyeGesturesConstructor;
    OHIFAndroidGazeBridge?: {
      capture: (
        screenX: number,
        screenY: number,
        timestamp?: number,
        metadata?: Record<string, unknown>
      ) => unknown;
      isReady: () => boolean;
    };
    OHIFEyeGesturesClient?: {
      connect: () => void;
      disconnect: () => void;
      getStatus: () => EyeGesturesStatus;
      getMessage: () => string | undefined;
      getUrl: () => string;
      recalibrate?: () => void;
    };
  }
}

const DEFAULT_SCRIPT_URL = 'https://eyegestures.com/eyegestures.js';
const DEFAULT_STYLESHEET_URL = 'https://eyegestures.com/eyegestures.css';
const STORAGE_SCRIPT_URL_KEY = 'ohif.eyeGestures.browserScriptUrl';
const STORAGE_ENABLED_KEY = 'ohif.eyeGestures.enabled';
const STATUS_EVENT = 'ohif-eyegestures-status';
const VIDEO_ID = 'video';
const STATUS_ID = 'status';
const ERROR_ID = 'error';
const EYE_GESTURES_UI_IDS = ['calibrationOverlay', 'logoDivEyeGestures', 'cursor', 'calib_cursor'];

let installed = false;
let connecting = false;
let status: EyeGesturesStatus = 'disconnected';
let lastMessage: string | undefined;
let currentScriptUrl = DEFAULT_SCRIPT_URL;
let currentStylesheetUrl = DEFAULT_STYLESHEET_URL;
let gestures: InstanceType<EyeGesturesConstructor> | null = null;
let cleanupUiSuppressor: (() => void) | null = null;

function getEyeGesturesConstructor(): EyeGesturesConstructor | undefined {
  if (window.EyeGestures) {
    return window.EyeGestures;
  }

  try {
    return (0, eval)('EyeGestures') as EyeGesturesConstructor;
  } catch {
    return undefined;
  }
}

function dispatchStatus(nextStatus: EyeGesturesStatus, message?: string) {
  status = nextStatus;
  lastMessage = message;
  window.dispatchEvent(
    new CustomEvent(STATUS_EVENT, {
      detail: {
        status: nextStatus,
        message,
        url: currentScriptUrl,
      },
    })
  );
}

function getConfiguredScriptUrl(options?: EyeGesturesBrowserClientOptions) {
  try {
    return (
      options?.scriptUrl ||
      window.localStorage.getItem(STORAGE_SCRIPT_URL_KEY) ||
      DEFAULT_SCRIPT_URL
    );
  } catch {
    return options?.scriptUrl || DEFAULT_SCRIPT_URL;
  }
}

function isDisabled() {
  try {
    return window.localStorage.getItem(STORAGE_ENABLED_KEY) === 'false';
  } catch {
    return false;
  }
}

function ensureElement<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tagName: K
): HTMLElementTagNameMap[K] {
  const existing = document.getElementById(id);
  if (existing) {
    return existing as HTMLElementTagNameMap[K];
  }

  const element = document.createElement(tagName);
  element.id = id;
  element.style.display = 'none';
  document.body.appendChild(element);

  return element;
}

function ensureEyeGesturesDom() {
  const video = ensureElement(VIDEO_ID, 'video');
  video.setAttribute('autoplay', 'true');
  video.setAttribute('playsinline', 'true');
  video.style.display = 'none';

  ensureElement(STATUS_ID, 'div');
  ensureElement(ERROR_ID, 'div');
}

function hideEyeGesturesUi() {
  EYE_GESTURES_UI_IDS.forEach(id => {
    const element = document.getElementById(id);

    if (!element) {
      return;
    }

    element.style.display = 'none';
    element.style.pointerEvents = 'none';
  });
}

function installEyeGesturesUiSuppressor() {
  hideEyeGesturesUi();

  const observer = new MutationObserver(hideEyeGesturesUi);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  return () => observer.disconnect();
}

function loadScript(url: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-ohif-eyegestures="true"]`
    );

    if (existing) {
      if (window.EyeGestures) {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), {
          once: true,
        });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.ohifEyegestures = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

function loadStylesheet(url: string) {
  if (!url || document.querySelector(`link[data-ohif-eyegestures-style="true"]`)) {
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.ohifEyegesturesStyle = 'true';
  document.head.appendChild(link);
}

function handleGaze(point: [number, number], calibration?: boolean) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  const nextStatus = calibration ? 'calibrating' : 'connected';
  dispatchStatus(
    nextStatus,
    calibration
      ? 'EyeGesturesLite calibrating; follow the red circle.'
      : 'EyeGesturesLite tracking active.'
  );

  window.OHIFAndroidGazeBridge?.capture?.(x, y, Date.now(), {
    source: 'eyegestures-browser',
    calibration: Boolean(calibration),
  });
}

async function connect() {
  if (connecting || gestures || typeof window === 'undefined') {
    return;
  }

  if (isDisabled()) {
    dispatchStatus('disconnected', 'EyeGestures disabled by localStorage.');
    return;
  }

  if (!window.isSecureContext) {
    dispatchStatus('disconnected', 'EyeGestures requires HTTPS or localhost for webcam access.');
    return;
  }

  connecting = true;
  dispatchStatus('waiting', 'Loading EyeGesturesLite.');

  try {
    ensureEyeGesturesDom();
    loadStylesheet(currentStylesheetUrl);
    await loadScript(currentScriptUrl);

    const EyeGestures = getEyeGesturesConstructor();

    if (!EyeGestures) {
      throw new Error('EyeGesturesLite script loaded without exposing window.EyeGestures.');
    }

    dispatchStatus('waiting', 'Requesting webcam permission.');
    gestures = new EyeGestures(VIDEO_ID, handleGaze);
    gestures.invisible?.();
    gestures.showCalibrationInstructions = onRead => onRead();
    cleanupUiSuppressor = installEyeGesturesUiSuppressor();
    gestures.start();
    hideEyeGesturesUi();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dispatchStatus('disconnected', message);
    gestures = null;
  } finally {
    connecting = false;
  }
}

export function installEyeGesturesBrowserClient(options?: EyeGesturesBrowserClientOptions) {
  if (typeof window === 'undefined' || installed) {
    return;
  }

  currentScriptUrl = getConfiguredScriptUrl(options);
  currentStylesheetUrl = options?.stylesheetUrl || DEFAULT_STYLESHEET_URL;
  installed = true;

  window.OHIFEyeGesturesClient = {
    connect,
    disconnect: uninstallEyeGesturesBrowserClient,
    getStatus: () => status,
    getMessage: () => lastMessage,
    getUrl: () => currentScriptUrl,
    recalibrate: () => gestures?.recalibrate?.(),
  };

  connect();
}

export function uninstallEyeGesturesBrowserClient() {
  gestures?.stop?.();
  cleanupUiSuppressor?.();
  cleanupUiSuppressor = null;
  hideEyeGesturesUi();
  gestures = null;
  installed = false;
  connecting = false;
  dispatchStatus('disconnected', 'EyeGesturesLite stopped.');
}
