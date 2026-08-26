import React, { useEffect, useState, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useLocation } from 'react-router-dom';
import { Enums } from '@cornerstonejs/core';

import { Icons, InvestigationalUseDialog } from '@ohif/ui-next';
import { HangingProtocolService, CommandsManager } from '@ohif/core';
import { PanelMeasurement } from '@ohif/extension-cornerstone';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import StudyFeedbackPage from './StudyFeedbackPage';
import StudyQuestionPanel from './StudyQuestionPanel';
import StudyReviewPanel, { StudyReviewHeatmapOverlay } from './StudyReviewPanel';
import GazeCalibrationGate from './GazeCalibrationGate';
import {
  getStudyInstanceUIDs,
  isAnnotationTool,
  isEvaluationAdminAccess,
  isEvaluationAttemptAccess,
  isEvaluationResultAccess,
  isReadOnlyViewerAccess,
} from './studyParams';
import { Onboarding, ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@ohif/ui-next';
import useResizablePanels from './ResizablePanelsHook';

const resizableHandleClassName = 'mt-[1px] bg-background';
const studyQuestionPanelStorageKey = 'ohif.studyQuestionPanelWidth.v2';
const studyQuestionPanelDefaultWidth = 320;
const studyQuestionPanelMinimumWidth = 280;
const studyQuestionPanelMaximumWidth = 560;
const studyQuestionViewportMinimumWidth = 320;
const studyQuestionPanelCollapsedWidth = 40;
const mobileViewportMediaQuery = '(max-width: 767px)';

const isMobileViewport = () =>
  typeof window !== 'undefined' && window.matchMedia(mobileViewportMediaQuery).matches;

const getRequestFailureMessage = (error: unknown, fallback: string): string => {
  const requestError = error as {
    message?: string;
    status?: number;
    response?: unknown;
    request?: { status?: number; response?: unknown; responseText?: string };
  };
  const status = requestError.status || requestError.request?.status;
  const response =
    requestError.response ?? requestError.request?.response ?? requestError.request?.responseText;

  if (status) {
    const detail =
      typeof response === 'string'
        ? response
        : response
          ? JSON.stringify(response)
          : requestError.message;
    return `Request failed (${status})${detail ? `: ${detail}` : ''}`;
  }

  return requestError.message || fallback;
};

const getStoredStudyQuestionPanelWidth = () => {
  try {
    const storedWidth = Number(window.localStorage.getItem(studyQuestionPanelStorageKey));
    if (Number.isFinite(storedWidth)) {
      return Math.min(
        studyQuestionPanelMaximumWidth,
        Math.max(studyQuestionPanelMinimumWidth, storedWidth)
      );
    }
  } catch {
    // ignore
  }

  return studyQuestionPanelDefaultWidth;
};

function ViewerLayout({
  // From Extension Module Params
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  // From Modes
  viewports,
  ViewportGridComp,
  leftPanelClosed = false,
  rightPanelClosed = false,
  leftPanelResizable = false,
  rightPanelResizable = false,
  leftPanelInitialExpandedWidth,
  rightPanelInitialExpandedWidth,
  leftPanelMinimumExpandedWidth,
  rightPanelMinimumExpandedWidth,
}: withAppTypes): React.FunctionComponent {
  const [appConfig] = useAppConfig();
  const location = useLocation();

  const {
    panelService,
    displaySetService,
    hangingProtocolService,
    customizationService,
    cornerstoneViewportService,
    measurementService,
    toolGroupService,
    viewportGridService,
    uiNotificationService,
  } = servicesManager.services;
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);
  const searchParams = new URLSearchParams(location.search);
  const isStudyReview = searchParams.get('studyReview') === '1';
  const isStudyFeedback = searchParams.get('studyFeedback') === '1';
  const isEvaluationAdmin = isEvaluationAdminAccess(location.search);
  const isEvaluationAttempt = isEvaluationAttemptAccess(location.search);
  const isEvaluationResult = isEvaluationResultAccess(location.search);
  const isReadOnlyViewer = isReadOnlyViewerAccess(location.search);
  const isEvaluationViewer = isEvaluationAdmin || isEvaluationAttempt || isEvaluationResult;
  const shouldEmitEvaluationContext = isEvaluationViewer;
  const resultSeriesInstanceUIDs = useMemo(
    () =>
      [
        ...searchParams.getAll('resultSeriesInstanceUIDs'),
        ...(searchParams.get('resultSeriesInstanceUID')
          ? [searchParams.get('resultSeriesInstanceUID')]
          : []),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    [location.search]
  );
  const studyInstanceUIDs = getStudyInstanceUIDs(location.search);
  const calibrationSessionId = `${location.key}:${[...studyInstanceUIDs].sort().join(',')}`;
  const studyQuestionPanelGroupRef = useRef<HTMLDivElement | null>(null);
  const studyQuestionPanelApiRef = useRef(null);
  const [studyQuestionPanelWidth, setStudyQuestionPanelWidth] = useState(
    getStoredStudyQuestionPanelWidth
  );
  const [studyQuestionPanelCollapsed, setStudyQuestionPanelCollapsed] = useState(isMobileViewport);
  const [studyQuestionPanelSize, setStudyQuestionPanelSize] = useState(25);
  const [studyQuestionPanelCollapsedSize, setStudyQuestionPanelCollapsedSize] = useState(0);
  const [studyQuestionPanelMinSize, setStudyQuestionPanelMinSize] = useState(0);
  const [studyQuestionPanelMaxSize, setStudyQuestionPanelMaxSize] = useState(100);
  const [studyQuestionViewportMinSize, setStudyQuestionViewportMinSize] = useState(0);

  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [leftPanelClosedState, setLeftPanelClosed] = useState(
    () => leftPanelClosed || isMobileViewport()
  );
  const [rightPanelClosedState, setRightPanelClosed] = useState(
    () => rightPanelClosed || isMobileViewport()
  );

  const [
    leftPanelProps,
    rightPanelProps,
    resizablePanelGroupProps,
    resizableLeftPanelProps,
    resizableViewportGridPanelProps,
    resizableRightPanelProps,
    onHandleDragging,
  ] = useResizablePanels(
    leftPanelClosedState,
    setLeftPanelClosed,
    rightPanelClosedState,
    setRightPanelClosed,
    hasLeftPanels,
    hasRightPanels,
    leftPanelInitialExpandedWidth,
    rightPanelInitialExpandedWidth,
    leftPanelMinimumExpandedWidth,
    rightPanelMinimumExpandedWidth
  );

  const handleMouseEnter = () => {
    (document.activeElement as HTMLElement)?.blur();
  };

  const requestViewportResize = useCallback(() => {
    window.requestAnimationFrame(() => {
      cornerstoneViewportService?.resize?.();
    });
  }, [cornerstoneViewportService]);

  const saveEvaluationResult = useCallback(async () => {
    const StudyInstanceUID = studyInstanceUIDs[0];
    if (!StudyInstanceUID) {
      uiNotificationService?.show({
        title: 'Save Finding',
        message: 'No study is loaded.',
        type: 'error',
      });
      return;
    }

    const measurementFilter = measurement => measurement?.referenceStudyUID === StudyInstanceUID;
    const measurements = measurementService?.getMeasurements?.(measurementFilter) || [];

    if (!measurements.length) {
      uiNotificationService?.show({
        title: 'Save Finding',
        message: 'Add at least one annotation before saving.',
        type: 'info',
      });
      return;
    }

    try {
      await commandsManager.run('promptSaveReport', {
        StudyInstanceUID,
        measurementFilter,
        defaultSaveTitle: 'Study Findings',
        skipPrompt: true,
      });
    } catch (error) {
      uiNotificationService?.show({
        title: 'Save Finding',
        message: getRequestFailureMessage(error, 'Unable to save annotations.'),
        type: 'error',
      });
    }
  }, [commandsManager, measurementService, studyInstanceUIDs, uiNotificationService]);

  useEffect(() => {
    if (!isReadOnlyViewer || !toolGroupService) {
      return;
    }

    const disableWritableTools = () => {
      toolGroupService.getToolGroupIds?.().forEach(toolGroupId => {
        const toolGroup = toolGroupService.getToolGroup?.(toolGroupId);
        const toolInstances = toolGroup?.toolOptions ? Object.keys(toolGroup.toolOptions) : [];

        toolInstances.forEach(toolName => {
          const isNavigationTool =
            /Pan|Zoom|WindowLevel|StackScroll|Trackball|Rotate|ReferenceLines|Crosshairs/i.test(
              toolName
            );

          if (isNavigationTool || !toolGroup?.hasTool?.(toolName)) {
            return;
          }

          // Annotation tools must stay in `Enabled` mode rather than `Disabled`: Cornerstone3D's
          // AnnotationRenderingEngine only draws annotations for tools in Active/Passive/Enabled
          // mode, so disabling them would hide the hydrated findings entirely. `Enabled` renders
          // them while keeping them non-interactive (no creation, no drag handles).
          if (isAnnotationTool(toolName)) {
            toolGroup.setToolEnabled(toolName);
            return;
          }

          toolGroup.setToolDisabled(toolName);
        });
      });
    };

    disableWritableTools();

    const subscriptions = [
      toolGroupService.EVENTS?.TOOLGROUP_CREATED
        ? toolGroupService.subscribe?.(
            toolGroupService.EVENTS.TOOLGROUP_CREATED,
            disableWritableTools
          )
        : undefined,
      toolGroupService.EVENTS?.VIEWPORT_ADDED
        ? toolGroupService.subscribe?.(toolGroupService.EVENTS.VIEWPORT_ADDED, disableWritableTools)
        : undefined,
      viewportGridService?.EVENTS?.VIEWPORTS_READY
        ? viewportGridService.subscribe?.(
            viewportGridService.EVENTS.VIEWPORTS_READY,
            disableWritableTools
          )
        : undefined,
    ];

    return () => {
      subscriptions.forEach(subscription => subscription?.unsubscribe?.());
    };
  }, [isReadOnlyViewer, toolGroupService, viewportGridService]);

  const emitEvaluationDicomContext = useCallback(() => {
    if (!shouldEmitEvaluationContext || !viewportGridService || !displaySetService) {
      return;
    }

    const viewportGridState = viewportGridService.getState?.();
    const activeViewportId =
      viewportGridService.getActiveViewportId?.() || viewportGridState?.activeViewportId;
    const activeViewport = activeViewportId
      ? viewportGridState?.viewports?.get?.(activeViewportId)
      : undefined;
    const displaySetInstanceUID = activeViewport?.displaySetInstanceUIDs?.[0];
    const displaySet = displaySetInstanceUID
      ? displaySetService.getDisplaySetByUID?.(displaySetInstanceUID)
      : undefined;
    const cornerstoneViewport = activeViewportId
      ? cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId)
      : undefined;
    const imageIndex = cornerstoneViewport?.getCurrentImageIdIndex?.();
    const instances = displaySet?.instances || displaySet?.images || [];
    const instance =
      typeof imageIndex === 'number'
        ? instances?.[imageIndex]
        : instances?.[0] || displaySet?.instance;

    window.parent?.postMessage(
      {
        type: 'radiology-expertly:evaluation-dicom-context',
        payload: {
          viewportId: activeViewportId || null,
          displaySetInstanceUID: displaySetInstanceUID || null,
          studyInstanceUID:
            instance?.StudyInstanceUID ||
            displaySet?.StudyInstanceUID ||
            studyInstanceUIDs[0] ||
            null,
          seriesInstanceUID: instance?.SeriesInstanceUID || displaySet?.SeriesInstanceUID || null,
          sopInstanceUID:
            instance?.SOPInstanceUID ||
            instance?.metadata?.SOPInstanceUID ||
            displaySet?.SOPInstanceUID ||
            null,
          frameIndex: typeof imageIndex === 'number' ? imageIndex : null,
          sliceIndex: typeof imageIndex === 'number' ? imageIndex : null,
        },
      },
      '*'
    );
  }, [
    cornerstoneViewportService,
    displaySetService,
    shouldEmitEvaluationContext,
    studyInstanceUIDs,
    viewportGridService,
  ]);

  useEffect(() => {
    if (!shouldEmitEvaluationContext || !viewportGridService) {
      return;
    }

    let removeViewportListeners: (() => void) | undefined;
    let retryHandle: ReturnType<typeof window.setTimeout> | undefined;

    const attachViewportListeners = () => {
      const viewportGridState = viewportGridService.getState?.();
      const activeViewportId =
        viewportGridService.getActiveViewportId?.() || viewportGridState?.activeViewportId;
      const viewport = activeViewportId
        ? cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId)
        : undefined;
      const element = viewport?.element;

      removeViewportListeners?.();
      emitEvaluationDicomContext();

      if (!element) {
        retryHandle = window.setTimeout(attachViewportListeners, 250);
        return;
      }

      const emit = () => emitEvaluationDicomContext();
      element.addEventListener(Enums.Events.STACK_NEW_IMAGE, emit);
      element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, emit);
      element.addEventListener(Enums.Events.IMAGE_RENDERED, emit);
      removeViewportListeners = () => {
        element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, emit);
        element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, emit);
        element.removeEventListener(Enums.Events.IMAGE_RENDERED, emit);
      };
    };

    attachViewportListeners();
    const activeViewportSubscription = viewportGridService.subscribe?.(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      attachViewportListeners
    );
    const viewportDataSubscription =
      cornerstoneViewportService?.EVENTS?.VIEWPORT_DATA_CHANGED &&
      cornerstoneViewportService.subscribe
        ? cornerstoneViewportService.subscribe(
            cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
            attachViewportListeners
          )
        : undefined;

    return () => {
      if (retryHandle) {
        window.clearTimeout(retryHandle);
      }
      activeViewportSubscription?.unsubscribe?.();
      viewportDataSubscription?.unsubscribe?.();
      removeViewportListeners?.();
    };
  }, [
    cornerstoneViewportService,
    emitEvaluationDicomContext,
    shouldEmitEvaluationContext,
    viewportGridService,
  ]);

  useEffect(() => {
    if (!(isEvaluationResult || isEvaluationAdmin) || !displaySetService) {
      return;
    }

    const hydratedSeriesInstanceUIDs = new Set<string>();
    let loadingResultDisplaySet = false;
    let retryHandle: ReturnType<typeof window.setTimeout> | undefined;
    let attempts = 0;
    // 250ms * 480 = up to 2 minutes; large referenced series can take a while to resolve their
    // imageIds on a cold cache, and every "still waiting" pass spends one attempt.
    const maxAttempts = 480;
    const scheduleHydrationRetry = () => {
      if (attempts < maxAttempts) {
        retryHandle = window.setTimeout(hydrateResultSeries, 250);
      }
    };
    const hydrateResultSeries = async () => {
      const activeDisplaySets = displaySetService.getActiveDisplaySets?.() || [];
      const seriesInstanceUIDs =
        resultSeriesInstanceUIDs.length > 0
          ? resultSeriesInstanceUIDs
          : activeDisplaySets
              .filter(displaySet => displaySet?.Modality === 'SR' || displaySet?.modality === 'SR')
              .map(displaySet => displaySet.SeriesInstanceUID)
              .filter(Boolean);

      if (!seriesInstanceUIDs.length) {
        attempts += 1;
        scheduleHydrationRetry();
        return;
      }

      if (hydratedSeriesInstanceUIDs.size === seriesInstanceUIDs.length) {
        return;
      }
      attempts += 1;

      const pendingSeriesInstanceUID = seriesInstanceUIDs.find(
        seriesInstanceUID => !hydratedSeriesInstanceUIDs.has(seriesInstanceUID)
      );
      const resultDisplaySet = activeDisplaySets.find(
        displaySet => displaySet?.SeriesInstanceUID === pendingSeriesInstanceUID
      );

      if (!resultDisplaySet?.displaySetInstanceUID) {
        scheduleHydrationRetry();
        return;
      }

      if (!resultDisplaySet.isLoaded && typeof resultDisplaySet.load === 'function') {
        if (loadingResultDisplaySet) {
          scheduleHydrationRetry();
          return;
        }

        loadingResultDisplaySet = true;
        try {
          await resultDisplaySet.load();
        } catch (error) {
          loadingResultDisplaySet = false;
          if (attempts < maxAttempts) {
            scheduleHydrationRetry();
          } else {
            uiNotificationService?.show({
              title: 'Finding View',
              message:
                error instanceof Error ? error.message : 'Unable to load finding annotations.',
              type: 'error',
            });
          }
          return;
        }
        loadingResultDisplaySet = false;
      }

      if (!Array.isArray(resultDisplaySet.measurements)) {
        scheduleHydrationRetry();
        return;
      }

      /**
       * `hydrateStructuredReport` builds its SOPInstanceUID -> imageId map purely from
       * `displaySet.measurements[].imageId`, which the SR SOP class handler only fills in once the
       * *referenced* image displaySet has been matched (`_checkIfCanAddMeasurementsToDisplaySet`).
       * The referenced series is usually still loading when the SR displaySet first appears, so
       * hydrating now yields an empty map and the CS3D adapter throws
       * `MetadataProvider::Empty imageId` — swallowed as a console.warn, leaving zero measurements
       * and a permanently empty Findings panel. Wait for the image references to resolve.
       */
      const hasUnresolvedImageReferences = resultDisplaySet.measurements.some(
        measurement => measurement?.coords?.[0]?.ValueType !== 'SCOORD3D' && !measurement?.imageId
      );

      if (hasUnresolvedImageReferences) {
        scheduleHydrationRetry();
        return;
      }

      try {
        const viewportGridState = viewportGridService?.getState?.();
        const viewportId =
          viewportGridService?.getActiveViewportId?.() ||
          (viewportGridState?.viewports
            ? Array.from(viewportGridState.viewports.keys())[0]
            : undefined);

        if (!viewportId) {
          scheduleHydrationRetry();
          return;
        }

        const result = await commandsManager.runCommand('hydrateStructuredReport', {
          displaySetInstanceUID: resultDisplaySet.displaySetInstanceUID,
        });

        const referencedSeriesUID = result?.SeriesInstanceUIDs?.[0];
        const referencedDisplaySet = referencedSeriesUID
          ? displaySetService.getDisplaySetsForSeries(referencedSeriesUID)?.[0]
          : undefined;

        if (referencedDisplaySet?.displaySetInstanceUID && viewportGridService) {
          commandsManager.runCommand('setDisplaySetsForViewports', {
            viewportsToUpdate: [
              {
                viewportId,
                displaySetInstanceUIDs: [referencedDisplaySet.displaySetInstanceUID],
              },
            ],
          });
        }
        if (pendingSeriesInstanceUID) {
          hydratedSeriesInstanceUIDs.add(pendingSeriesInstanceUID);
        }
        if (hydratedSeriesInstanceUIDs.size < seriesInstanceUIDs.length) {
          scheduleHydrationRetry();
        }
      } catch (error) {
        if (attempts < maxAttempts) {
          scheduleHydrationRetry();
        } else {
          uiNotificationService?.show({
            title: 'Finding View',
            message: error instanceof Error ? error.message : 'Unable to load finding annotations.',
            type: 'error',
          });
        }
      }
    };

    hydrateResultSeries();
    const subscription = displaySetService.subscribe?.(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      hydrateResultSeries
    );

    return () => {
      if (retryHandle) {
        window.clearTimeout(retryHandle);
      }
      subscription?.unsubscribe?.();
    };
  }, [
    commandsManager,
    displaySetService,
    isEvaluationAdmin,
    isEvaluationResult,
    resultSeriesInstanceUIDs,
    uiNotificationService,
    viewportGridService,
  ]);

  const setStudyQuestionCollapsed = useCallback(
    (collapsed: boolean) => {
      setStudyQuestionPanelCollapsed(collapsed);
      window.requestAnimationFrame(() => {
        if (collapsed) {
          studyQuestionPanelApiRef.current?.collapse?.();
        } else {
          studyQuestionPanelApiRef.current?.expand?.(studyQuestionPanelSize);
          studyQuestionPanelApiRef.current?.resize?.(studyQuestionPanelSize);
        }

        requestViewportResize();
      });
    },
    [requestViewportResize, studyQuestionPanelSize]
  );

  const getStudyQuestionPanelSize = useCallback((pixelWidth: number, groupWidth?: number) => {
    const panelGroupWidth =
      groupWidth ?? studyQuestionPanelGroupRef.current?.getBoundingClientRect().width;

    if (!panelGroupWidth) {
      return 0;
    }

    return (pixelWidth / panelGroupWidth) * 100;
  }, []);

  const getStudyQuestionPixelWidth = useCallback(
    (percentageSize: number) => {
      const panelGroupWidth = studyQuestionPanelGroupRef.current?.getBoundingClientRect().width;

      if (!panelGroupWidth) {
        return studyQuestionPanelWidth;
      }

      return (percentageSize / 100) * panelGroupWidth;
    },
    [studyQuestionPanelWidth]
  );

  useLayoutEffect(() => {
    const panelGroupElement = studyQuestionPanelGroupRef.current;

    if (!panelGroupElement || isStudyReview) {
      return;
    }

    const updateResizableSizes = () => {
      const { width: panelGroupWidth } = panelGroupElement.getBoundingClientRect();

      if (!panelGroupWidth) {
        return;
      }

      const minimumPanelWidth = Math.min(studyQuestionPanelMinimumWidth, panelGroupWidth);
      const collapsedPanelWidth = Math.min(studyQuestionPanelCollapsedWidth, panelGroupWidth);
      const minimumViewportWidth = Math.min(
        studyQuestionViewportMinimumWidth,
        Math.max(0, panelGroupWidth - minimumPanelWidth)
      );
      const maximumPanelWidth = Math.min(
        studyQuestionPanelMaximumWidth,
        Math.max(minimumPanelWidth, panelGroupWidth - minimumViewportWidth)
      );
      const nextPanelWidth = Math.min(
        maximumPanelWidth,
        Math.max(minimumPanelWidth, studyQuestionPanelWidth)
      );
      const nextPanelSize = getStudyQuestionPanelSize(nextPanelWidth, panelGroupWidth);

      setStudyQuestionPanelCollapsedSize(
        getStudyQuestionPanelSize(collapsedPanelWidth, panelGroupWidth)
      );
      setStudyQuestionPanelMinSize(getStudyQuestionPanelSize(minimumPanelWidth, panelGroupWidth));
      setStudyQuestionPanelMaxSize(getStudyQuestionPanelSize(maximumPanelWidth, panelGroupWidth));
      setStudyQuestionViewportMinSize(
        getStudyQuestionPanelSize(minimumViewportWidth, panelGroupWidth)
      );
      setStudyQuestionPanelSize(nextPanelSize);
      if (studyQuestionPanelCollapsed) {
        studyQuestionPanelApiRef.current?.collapse?.();
      } else {
        studyQuestionPanelApiRef.current?.resize(nextPanelSize);
      }
    };

    updateResizableSizes();

    const observer = new ResizeObserver(updateResizableSizes);
    observer.observe(panelGroupElement);

    return () => observer.disconnect();
  }, [
    getStudyQuestionPanelSize,
    isStudyReview,
    studyQuestionPanelCollapsed,
    studyQuestionPanelWidth,
  ]);

  const handleStudyQuestionPanelResize = useCallback(
    size => {
      if (isStudyReview) {
        return;
      }

      if (studyQuestionPanelApiRef.current?.isCollapsed?.()) {
        setStudyQuestionPanelCollapsed(true);
        requestViewportResize();
        return;
      }

      setStudyQuestionPanelCollapsed(false);

      const nextPanelWidth = Math.min(
        studyQuestionPanelMaximumWidth,
        Math.max(studyQuestionPanelMinimumWidth, getStudyQuestionPixelWidth(size))
      );

      setStudyQuestionPanelWidth(nextPanelWidth);

      try {
        window.localStorage.setItem(
          studyQuestionPanelStorageKey,
          String(Math.round(nextPanelWidth))
        );
      } catch {
        // ignore
      }

      requestViewportResize();
    },
    [getStudyQuestionPixelWidth, isStudyReview, requestViewportResize]
  );

  const handleStudyQuestionPanelDragging = useCallback(
    isStartDrag => {
      if (!isStartDrag) {
        requestViewportResize();
      }
    },
    [requestViewportResize]
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileViewportMediaQuery);
    const handleViewportChange = event => {
      if (!event.matches) {
        return;
      }

      setLeftPanelClosed(true);
      setRightPanelClosed(true);
      setStudyQuestionCollapsed(true);
    };

    handleViewportChange(mediaQuery);
    mediaQuery.addEventListener('change', handleViewportChange);

    return () => {
      mediaQuery.removeEventListener('change', handleViewportChange);
    };
  }, [setStudyQuestionCollapsed]);

  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  /**
   * Set body classes (tailwindcss) that don't allow vertical
   * or horizontal overflow (no scrolling). Also guarantee window
   * is sized to our viewport.
   */
  useEffect(() => {
    document.body.classList.add('bg-background');
    document.body.classList.add('overflow-hidden');

    return () => {
      document.body.classList.remove('bg-background');
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  const getComponent = id => {
    const entry = extensionManager.getModuleEntry(id);

    if (!entry || !entry.component) {
      throw new Error(
        `${id} is not valid for an extension module or no component found from extension ${id}. Please verify your configuration or ensure that the extension is properly registered. It's also possible that your mode is utilizing a module from an extension that hasn't been included in its dependencies (add the extension to the "extensionDependencies" array in your mode's index.js file). Check the reference string to the extension in your Mode configuration`
      );
    }

    return { entry };
  };

  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      HangingProtocolService.EVENTS.PROTOCOL_CHANGED,

      // Todo: right now to set the loading indicator to false, we need to wait for the
      // hangingProtocolService to finish applying the viewport matching to each viewport,
      // however, this might not be the only approach to set the loading indicator to false. we need to explore this further.
      () => {
        setShowLoadingIndicator(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [hangingProtocolService]);

  const getViewportComponentData = viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);

    return {
      component: entry.component,
      isReferenceViewable: entry.isReferenceViewable,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      ({ options }) => {
        setHasLeftPanels(hasPanels('left'));
        setHasRightPanels(hasPanels('right'));
        if (options?.leftPanelClosed !== undefined) {
          setLeftPanelClosed(options.leftPanelClosed);
        }
        if (options?.rightPanelClosed !== undefined) {
          setRightPanelClosed(options.rightPanelClosed);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [panelService, hasPanels]);

  const viewportComponents = viewports.map(getViewportComponentData);

  return (
    <div>
      <ViewerHeader
        hotkeysManager={hotkeysManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        appConfig={isStudyFeedback ? { ...appConfig, showStudyList: false } : appConfig}
      />
      <div
        className="bg-background relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden"
        style={{ height: 'calc(100vh - 52px)' }}
      >
        <React.Fragment>
          {!isStudyFeedback && showLoadingIndicator && (
            <LoadingIndicatorProgress className="bg-background h-full w-full" />
          )}
          <ResizablePanelGroup {...resizablePanelGroupProps}>
            {/* LEFT SIDEPANELS */}
            {!isStudyFeedback && hasLeftPanels ? (
              <>
                <ResizablePanel {...resizableLeftPanelProps}>
                  <SidePanelWithServices
                    side="left"
                    isExpanded={!leftPanelClosedState}
                    servicesManager={servicesManager}
                    {...leftPanelProps}
                  />
                </ResizablePanel>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!leftPanelResizable}
                  className={resizableHandleClassName}
                />
              </>
            ) : null}
            {/* TOOLBAR + GRID */}
            <ResizablePanel {...resizableViewportGridPanelProps}>
              <div className="flex h-full min-w-0 flex-1 flex-col">
                {isStudyFeedback ? (
                  <StudyFeedbackPage />
                ) : isStudyReview ? (
                  <div
                    className="bg-background relative flex h-full min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
                    onMouseEnter={handleMouseEnter}
                  >
                    <div className="bg-background relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
                      <ViewportGridComp
                        servicesManager={servicesManager}
                        viewportComponents={viewportComponents}
                        commandsManager={commandsManager}
                      />
                      <StudyReviewHeatmapOverlay servicesManager={servicesManager} />
                    </div>
                    {studyQuestionPanelCollapsed ? (
                      <aside className="border-input bg-muted/30 flex h-10 w-full shrink-0 items-center justify-center border-t md:h-full md:w-10 md:flex-col md:border-l md:border-t-0 md:pt-2">
                        <button
                          type="button"
                          onClick={() => setStudyQuestionCollapsed(false)}
                          aria-label="Open review panel"
                          title="Open review panel"
                          className="hover:bg-primary/10 focus:ring-primary-main text-primary flex h-8 w-8 items-center justify-center rounded transition focus:outline-none focus:ring-2"
                        >
                          <Icons.NavigationPanelReveal className="h-5 w-5" />
                        </button>
                      </aside>
                    ) : (
                      <StudyReviewPanel
                        servicesManager={servicesManager}
                        onToggleCollapsed={() => setStudyQuestionCollapsed(true)}
                      />
                    )}
                  </div>
                ) : isEvaluationViewer ? (
                  <div
                    className="bg-background relative flex h-full min-h-0 flex-1 overflow-hidden"
                    onMouseEnter={handleMouseEnter}
                  >
                    {isEvaluationAdmin && (
                      <div className="absolute right-16 top-4 z-10">
                        <button
                          type="button"
                          onClick={saveEvaluationResult}
                          className="bg-primary-main hover:bg-primary-light focus:ring-primary-light text-primary-foreground inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-medium shadow-lg transition focus:outline-none focus:ring-2"
                          title="Save annotations as finding"
                        >
                          <Icons.Add className="h-4 w-4" />
                          <span>Save finding</span>
                        </button>
                      </div>
                    )}
                    <div className="relative flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
                      <ViewportGridComp
                        servicesManager={servicesManager}
                        viewportComponents={viewportComponents}
                        commandsManager={commandsManager}
                      />
                    </div>
                    {(isEvaluationAdmin || isEvaluationResult) && (
                      <aside className="border-input bg-background/95 h-full w-80 shrink-0 overflow-y-auto border-l p-3">
                        <div className="text-foreground mb-3 text-sm font-semibold">Findings</div>
                        <PanelMeasurement
                          servicesManager={servicesManager}
                          commandsManager={commandsManager}
                          extensionManager={extensionManager}
                          emptyComponent={() => (
                            <div className="text-muted-foreground text-sm">
                              {isEvaluationResult ? 'No findings linked.' : 'No findings yet.'}
                            </div>
                          )}
                        />
                      </aside>
                    )}
                  </div>
                ) : (
                  <GazeCalibrationGate
                    studyInstanceUIDs={studyInstanceUIDs}
                    calibrationSessionId={calibrationSessionId}
                  >
                    <div
                      ref={studyQuestionPanelGroupRef}
                      className="bg-background relative h-full min-h-0 flex-1 overflow-hidden"
                      onMouseEnter={handleMouseEnter}
                    >
                      <ResizablePanelGroup
                        direction="horizontal"
                        onLayout={requestViewportResize}
                      >
                        <ResizablePanel
                          order={0}
                          id="viewerLayoutResizableStudyQuestionViewportPanel"
                          minSize={studyQuestionViewportMinSize}
                        >
                          <div className="bg-background relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
                            <ViewportGridComp
                              servicesManager={servicesManager}
                              viewportComponents={viewportComponents}
                              commandsManager={commandsManager}
                            />
                          </div>
                        </ResizablePanel>
                        <ResizableHandle
                          onDragging={handleStudyQuestionPanelDragging}
                          className={resizableHandleClassName}
                        />
                        <ResizablePanel
                          order={1}
                          id="viewerLayoutResizableStudyQuestionPanel"
                          defaultSize={studyQuestionPanelSize}
                          minSize={
                            studyQuestionPanelCollapsed
                              ? studyQuestionPanelCollapsedSize
                              : studyQuestionPanelMinSize
                          }
                          maxSize={studyQuestionPanelMaxSize}
                          collapsible
                          collapsedSize={studyQuestionPanelCollapsedSize}
                          onResize={handleStudyQuestionPanelResize}
                          onCollapse={() => setStudyQuestionPanelCollapsed(true)}
                          onExpand={() => setStudyQuestionPanelCollapsed(false)}
                          ref={studyQuestionPanelApiRef}
                        >
                          {studyQuestionPanelCollapsed ? (
                            <aside className="border-input bg-muted/30 flex h-full w-full flex-col items-center border-l pt-2">
                              <button
                                type="button"
                                onClick={() => setStudyQuestionCollapsed(false)}
                                aria-label="Open study question panel"
                                title="Open study question panel"
                                className="hover:bg-primary/10 focus:ring-primary-main text-primary flex h-8 w-8 items-center justify-center rounded transition focus:outline-none focus:ring-2"
                              >
                                <Icons.NavigationPanelReveal className="h-5 w-5" />
                              </button>
                            </aside>
                          ) : (
                            <StudyQuestionPanel
                              servicesManager={servicesManager}
                              onToggleCollapsed={() => setStudyQuestionCollapsed(true)}
                            />
                          )}
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    </div>
                  </GazeCalibrationGate>
                )}
              </div>
            </ResizablePanel>
            {!isStudyFeedback && !isEvaluationViewer && hasRightPanels ? (
              <>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!rightPanelResizable}
                  className={resizableHandleClassName}
                />
                <ResizablePanel {...resizableRightPanelProps}>
                  <SidePanelWithServices
                    side="right"
                    isExpanded={!rightPanelClosedState}
                    servicesManager={servicesManager}
                    {...rightPanelProps}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </React.Fragment>
      </div>
      <Onboarding tours={customizationService.getCustomization('ohif.tours')} />
      <InvestigationalUseDialog dialogConfiguration={appConfig?.investigationalUseDialog} />
    </div>
  );
}

ViewerLayout.propTypes = {
  // From extension module params
  extensionManager: PropTypes.shape({
    getModuleEntry: PropTypes.func.isRequired,
  }).isRequired,
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object.isRequired,
  // From modes
  leftPanels: PropTypes.array,
  rightPanels: PropTypes.array,
  leftPanelClosed: PropTypes.bool.isRequired,
  rightPanelClosed: PropTypes.bool.isRequired,
  /** Responsible for rendering our grid of viewports; provided by consuming application */
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
  viewports: PropTypes.array,
};

export default ViewerLayout;
