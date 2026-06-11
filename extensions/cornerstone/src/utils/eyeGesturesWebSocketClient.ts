type EyeGesturesStatus = 'connected' | 'disconnected' | 'waiting' | 'calibrating';

type EyeGesturesMessage = {
  type?: string;
  x?: number;
  y?: number;
  timestamp?: number;
  confidence?: number;
  fixation?: boolean;
  saccades?: boolean;
  status?: EyeGesturesStatus;
  message?: string;
};

type EyeGesturesClientOptions = {
  url?: string;
  reconnectMs?: number;
};

declare global {
  interface Window {
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
    };
  }
}

const DEFAULT_URL = 'ws://localhost:8765/gaze';
const DEFAULT_RECONNECT_MS = 2500;
const STORAGE_URL_KEY = 'ohif.eyeGestures.wsUrl';
const STORAGE_ENABLED_KEY = 'ohif.eyeGestures.enabled';
const STORAGE_MOUSE_FALLBACK_KEY = 'ohif.eyeGestures.mouseFallback';
const STATUS_EVENT = 'ohif-eyegestures-status';

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let mouseFallbackCleanup: (() => void) | null = null;
let installed = false;
let status: EyeGesturesStatus = 'disconnected';
let lastMessage: string | undefined;
let currentUrl = DEFAULT_URL;
let reconnectMs = DEFAULT_RECONNECT_MS;
let shouldReconnect = true;

function dispatchStatus(nextStatus: EyeGesturesStatus, message?: string) {
  status = nextStatus;
  lastMessage = message;
  window.dispatchEvent(
    new CustomEvent(STATUS_EVENT, {
      detail: {
        status: nextStatus,
        message,
        url: currentUrl,
      },
    })
  );
}

function getConfiguredUrl(options?: EyeGesturesClientOptions) {
  try {
    return options?.url || window.localStorage.getItem(STORAGE_URL_KEY) || DEFAULT_URL;
  } catch {
    return options?.url || DEFAULT_URL;
  }
}

function isDisabled() {
  try {
    return window.localStorage.getItem(STORAGE_ENABLED_KEY) === 'false';
  } catch {
    return false;
  }
}

function isMouseFallbackEnabled() {
  try {
    const params = new URLSearchParams(window.location.search);

    return (
      params.get('gazeMouseFallback') === '1' ||
      window.localStorage.getItem(STORAGE_MOUSE_FALLBACK_KEY) === 'true'
    );
  } catch {
    return false;
  }
}

function installMouseFallback() {
  if (mouseFallbackCleanup || !isMouseFallbackEnabled()) {
    return;
  }

  let lastCaptureAt = 0;

  const handlePointerMove = (event: PointerEvent) => {
    const now = Date.now();

    if (now - lastCaptureAt < 80 || !window.OHIFAndroidGazeBridge?.isReady?.()) {
      return;
    }

    const record = window.OHIFAndroidGazeBridge.capture(event.clientX, event.clientY, now, {
      source: 'mouse-fallback',
      confidence: 0.5,
    });

    if (record) {
      lastCaptureAt = now;
      dispatchStatus('connected', 'Mouse fallback gaze stream active.');
    }
  };

  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  dispatchStatus('waiting', 'Mouse fallback enabled; move the pointer over the image viewport.');

  mouseFallbackCleanup = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    mouseFallbackCleanup = null;
  };
}

function uninstallMouseFallback() {
  mouseFallbackCleanup?.();
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();

  if (!shouldReconnect || isDisabled()) {
    return;
  }

  reconnectTimer = window.setTimeout(connect, reconnectMs);
}

function normalizeTimestamp(timestamp?: number) {
  const nextTimestamp = Number(timestamp);

  if (!Number.isFinite(nextTimestamp)) {
    return Date.now();
  }

  return nextTimestamp < 10000000000 ? nextTimestamp * 1000 : nextTimestamp;
}

function handleGazeMessage(message: EyeGesturesMessage) {
  const x = Number(message.x);
  const y = Number(message.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  dispatchStatus(
    message.status === 'calibrating' || message.status === 'waiting' ? message.status : 'connected',
    message.message || 'Receiving EyeGestures gaze samples.'
  );

  window.OHIFAndroidGazeBridge?.capture?.(x, y, normalizeTimestamp(message.timestamp), {
    source: 'eyegestures',
    confidence: typeof message.confidence === 'number' ? message.confidence : undefined,
    fixation: typeof message.fixation === 'boolean' ? message.fixation : undefined,
    saccades: typeof message.saccades === 'boolean' ? message.saccades : undefined,
  });
}

function handleMessage(event: MessageEvent) {
  let message: EyeGesturesMessage;

  try {
    message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'status' && message.status) {
    dispatchStatus(message.status, message.message);
    return;
  }

  if (!message.type || message.type === 'gaze') {
    handleGazeMessage(message);
  }
}

function connect() {
  clearReconnectTimer();
  installMouseFallback();

  if (typeof window === 'undefined' || typeof WebSocket === 'undefined' || isDisabled()) {
    dispatchStatus('disconnected');
    return;
  }

  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    socket = new WebSocket(currentUrl);
  } catch {
    dispatchStatus('disconnected');
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    dispatchStatus('waiting', 'Connected to EyeGestures sidecar; waiting for gaze samples.');
  };

  socket.onmessage = handleMessage;

  socket.onerror = () => {
    socket?.close();
  };

  socket.onclose = () => {
    socket = null;
    dispatchStatus('disconnected');
    scheduleReconnect();
  };
}

export function installEyeGesturesWebSocketClient(options?: EyeGesturesClientOptions) {
  if (typeof window === 'undefined') {
    return;
  }

  currentUrl = getConfiguredUrl(options);
  reconnectMs = options?.reconnectMs ?? DEFAULT_RECONNECT_MS;
  shouldReconnect = true;

  window.OHIFEyeGesturesClient = {
    connect,
    disconnect: uninstallEyeGesturesWebSocketClient,
    getStatus: () => status,
    getMessage: () => lastMessage,
    getUrl: () => currentUrl,
  };

  if (installed) {
    return;
  }

  installed = true;
  connect();
}

export function uninstallEyeGesturesWebSocketClient() {
  shouldReconnect = false;
  clearReconnectTimer();
  uninstallMouseFallback();

  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
    socket = null;
  }

  installed = false;
  dispatchStatus('disconnected');
}
