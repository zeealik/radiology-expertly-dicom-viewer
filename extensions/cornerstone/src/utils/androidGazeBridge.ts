import { metaData } from '@cornerstonejs/core';

type ServicesManager = {
  services: {
    cornerstoneViewportService: any;
    viewportGridService?: any;
  };
};

type RegisteredViewport = {
  viewportId: string;
  element: HTMLElement;
};

type GazeRecord = {
  timestamp: number;
  source?: string;
  confidence?: number;
  fixation?: boolean;
  saccades?: boolean;
  viewportId: string;
  activeViewportId?: string;
  screenX: number;
  screenY: number;
  viewportX: number;
  viewportY: number;
  viewportNormalizedX: number;
  viewportNormalizedY: number;
  viewportWidth: number;
  viewportHeight: number;
  world?: number[];
  sliceIndex?: number;
  numberOfSlices?: number;
  imageId?: string;
  viewportType?: string;
  displaySetInstanceUID?: string;
  StudyInstanceUID?: string;
  SeriesInstanceUID?: string;
  SOPInstanceUID?: string;
  instanceNumber?: number;
  FrameOfReferenceUID?: string;
};

declare global {
  interface Window {
    AndroidBridge?: {
      onGazeBridgeReady?: (payload: string) => void;
      onGazeRecord?: (record: string) => void;
    };
    OHIFAndroidGazeBridge?: {
      capture: (
        screenX: number,
        screenY: number,
        timestamp?: number,
        metadata?: Partial<GazeRecord>
      ) => GazeRecord | null;
      captureJson: (screenX: number, screenY: number, timestamp?: number) => string | null;
      getRegisteredViewports: () => string[];
      isReady: () => boolean;
    };
    receiveGazePoint?: (screenX: number, screenY: number, timestamp?: number) => GazeRecord | null;
  }
}

let servicesManagerRef: ServicesManager | null = null;
const registeredViewports = new Map<string, RegisteredViewport>();

function findViewportAtPoint(screenX: number, screenY: number): RegisteredViewport | null {
  for (const registeredViewport of registeredViewports.values()) {
    const rect = registeredViewport.element.getBoundingClientRect();

    if (
      screenX >= rect.left &&
      screenX <= rect.right &&
      screenY >= rect.top &&
      screenY <= rect.bottom
    ) {
      return registeredViewport;
    }
  }

  const activeViewportId =
    servicesManagerRef?.services.viewportGridService?.getActiveViewportId?.() ?? null;

  return activeViewportId ? (registeredViewports.get(activeViewportId) ?? null) : null;
}

function getPrimaryViewportData(viewportInfo: any) {
  const viewportData = viewportInfo?.getViewportData?.();
  const data = viewportData?.data;

  return Array.isArray(data) ? data[0] : data;
}

function getCurrentImageId(viewport: any, primaryViewportData: any): string | undefined {
  const imageId = viewport?.getCurrentImageId?.();

  if (imageId) {
    return imageId;
  }

  const imageIndex = viewport?.getCurrentImageIdIndex?.();

  if (Number.isInteger(imageIndex)) {
    return (
      primaryViewportData?.imageIds?.[imageIndex] ??
      primaryViewportData?.volume?.imageIds?.[imageIndex]
    );
  }
}

function getDicomMetadata(imageId?: string, primaryViewportData?: any) {
  if (!imageId) {
    return {
      StudyInstanceUID: primaryViewportData?.StudyInstanceUID,
    };
  }

  const generalImageModule = metaData.get('generalImageModule', imageId) || {};
  const generalSeriesModule = metaData.get('generalSeriesModule', imageId) || {};
  const generalStudyModule = metaData.get('generalStudyModule', imageId) || {};
  const sopCommonModule = metaData.get('sopCommonModule', imageId) || {};
  const imagePlaneModule = metaData.get('imagePlaneModule', imageId) || {};

  return {
    StudyInstanceUID: generalStudyModule.studyInstanceUID ?? primaryViewportData?.StudyInstanceUID,
    SeriesInstanceUID: generalSeriesModule.seriesInstanceUID,
    SOPInstanceUID: sopCommonModule.sopInstanceUID,
    instanceNumber: generalImageModule.instanceNumber,
    FrameOfReferenceUID: imagePlaneModule.frameOfReferenceUID,
  };
}

function notifyAndroid(record: GazeRecord) {
  const payload = JSON.stringify(record);

  window.dispatchEvent(
    new CustomEvent('ohif-android-gaze-record', {
      detail: record,
    })
  );

  try {
    window.AndroidBridge?.onGazeRecord?.(payload);
  } catch (error) {
    console.warn('[OHIFAndroidGazeBridge] Failed to send gaze record to AndroidBridge', error);
  }
}

function notifyBridgeReady() {
  const payload = JSON.stringify({
    ready: true,
    viewportIds: Array.from(registeredViewports.keys()),
  });

  window.dispatchEvent(
    new CustomEvent('ohif-android-gaze-bridge-ready', {
      detail: JSON.parse(payload),
    })
  );

  try {
    window.AndroidBridge?.onGazeBridgeReady?.(payload);
  } catch (error) {
    console.warn('[OHIFAndroidGazeBridge] Failed to notify AndroidBridge readiness', error);
  }
}

function capture(
  screenX: number,
  screenY: number,
  timestamp = Date.now(),
  metadata: Partial<GazeRecord> = {}
): GazeRecord | null {
  const servicesManager = servicesManagerRef;

  if (!servicesManager || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return null;
  }

  const registeredViewport = findViewportAtPoint(screenX, screenY);

  if (!registeredViewport) {
    return null;
  }

  const { viewportId, element } = registeredViewport;
  const rect = element.getBoundingClientRect();
  const viewportX = screenX - rect.left;
  const viewportY = screenY - rect.top;
  const { cornerstoneViewportService, viewportGridService } = servicesManager.services;
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
  const primaryViewportData = getPrimaryViewportData(viewportInfo);
  const imageId = getCurrentImageId(viewport, primaryViewportData);
  const imageIds =
    viewport?.getImageIds?.() ??
    primaryViewportData?.imageIds ??
    primaryViewportData?.volume?.imageIds;
  const world = viewport?.canvasToWorld?.([viewportX, viewportY]);
  const dicomMetadata = getDicomMetadata(imageId, primaryViewportData);

  const record: GazeRecord = {
    timestamp,
    source: metadata.source,
    confidence: metadata.confidence,
    fixation: metadata.fixation,
    saccades: metadata.saccades,
    viewportId,
    activeViewportId: viewportGridService?.getActiveViewportId?.(),
    screenX,
    screenY,
    viewportX,
    viewportY,
    viewportNormalizedX: rect.width ? viewportX / rect.width : 0,
    viewportNormalizedY: rect.height ? viewportY / rect.height : 0,
    viewportWidth: rect.width,
    viewportHeight: rect.height,
    world: world ? Array.from(world) : undefined,
    sliceIndex: viewport?.getCurrentImageIdIndex?.(),
    numberOfSlices: imageIds?.length,
    imageId,
    viewportType: viewportInfo?.getViewportOptions?.()?.viewportType,
    displaySetInstanceUID: primaryViewportData?.displaySetInstanceUID,
    ...dicomMetadata,
  };

  notifyAndroid(record);

  return record;
}

export function registerAndroidGazeViewport(
  servicesManager: ServicesManager,
  viewportId: string,
  element: HTMLElement
) {
  servicesManagerRef = servicesManager;
  registeredViewports.set(viewportId, { viewportId, element });
  installAndroidGazeBridge();
  notifyBridgeReady();
}

export function unregisterAndroidGazeViewport(viewportId: string) {
  registeredViewports.delete(viewportId);
}

export function installAndroidGazeBridge() {
  window.OHIFAndroidGazeBridge = {
    capture,
    captureJson: (screenX: number, screenY: number, timestamp?: number) => {
      const record = capture(screenX, screenY, timestamp);
      return record ? JSON.stringify(record) : null;
    },
    getRegisteredViewports: () => Array.from(registeredViewports.keys()),
    isReady: () => registeredViewports.size > 0,
  };

  window.receiveGazePoint = capture;
}
