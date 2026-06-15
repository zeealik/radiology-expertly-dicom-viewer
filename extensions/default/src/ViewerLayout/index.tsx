import React, { useEffect, useState, useCallback, useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useLocation } from 'react-router-dom';

import { Icons, InvestigationalUseDialog } from '@ohif/ui-next';
import { HangingProtocolService, CommandsManager } from '@ohif/core';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import StudyFeedbackPage from './StudyFeedbackPage';
import StudyQuestionPanel from './StudyQuestionPanel';
import StudyReviewPanel, { StudyReviewHeatmapOverlay } from './StudyReviewPanel';
import GazeCalibrationGate from './GazeCalibrationGate';
import { getStudyInstanceUIDs } from './studyParams';
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

  const { panelService, hangingProtocolService, customizationService, cornerstoneViewportService } =
    servicesManager.services;
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);
  const searchParams = new URLSearchParams(location.search);
  const isStudyReview = searchParams.get('studyReview') === '1';
  const isStudyFeedback = searchParams.get('studyFeedback') === '1';
  const studyInstanceUIDs = getStudyInstanceUIDs(location.search);
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
                ) : (
                  <GazeCalibrationGate studyInstanceUIDs={studyInstanceUIDs}>
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
            {!isStudyFeedback && hasRightPanels ? (
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
