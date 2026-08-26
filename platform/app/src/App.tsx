// External

import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import i18n from '@ohif/i18n';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, type BrowserRouterProps } from 'react-router-dom';

import Compose from './routes/Mode/Compose';
import {
  ExtensionManager,
  CommandsManager,
  HotkeysManager,
  ServiceProvidersManager,
  SystemContextProvider,
  ViewportRefsProvider,
} from '@ohif/core';
import {
  ThemeWrapper as ThemeWrapperNext,
  NotificationProvider,
  ViewportGridProvider,
  DialogProvider,
  CineProvider,
  TooltipProvider,
  Modal as ModalNext,
  ManagedDialog,
  ModalProvider,
  ViewportDialogProvider,
  UserAuthenticationProvider,
} from '@ohif/ui-next';
// Viewer Project
// TODO: Should this influence study list?
import { AppConfigProvider } from '@state';
import createRoutes from './routes';
import appInit from './appInit.js';
import OpenIdConnectRoutes from './utils/OpenIdConnectRoutes';
import { ShepherdJourneyProvider } from 'react-shepherd';
import './App.css';

let commandsManager: CommandsManager,
  extensionManager: ExtensionManager,
  servicesManager: AppTypes.ServicesManager,
  serviceProvidersManager: ServiceProvidersManager,
  hotkeysManager: HotkeysManager;

const routerFutureFlags: BrowserRouterProps['future'] = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

const DICOM_PRELOAD_MESSAGE_TYPE = 'radiology-expertly:dicom-preload-progress';
const DICOM_PRELOAD_INITIAL_PROGRESS = {
  failedImages: 0,
  loadedDisplaySets: 0,
  loadedImages: 0,
  progress: 0,
  totalDisplaySets: 0,
  totalImages: 0,
  isComplete: false,
};

function shouldTrackDicomPreloadProgress() {
  const searchParams = new URLSearchParams(window.location.search);
  const preloadAllImages = searchParams.get('preloadAllImages');
  const hasStudyParams =
    searchParams.has('StudyInstanceUID') || searchParams.has('StudyInstanceUIDs');

  return preloadAllImages !== '0' && hasStudyParams;
}

function DicomPreloadProgressBridge({ servicesManager }) {
  const [localProgress, setLocalProgress] = useState(DICOM_PRELOAD_INITIAL_PROGRESS);

  useEffect(() => {
    const shouldTrackProgress = shouldTrackDicomPreloadProgress();
    const shouldPostProgress = window.parent !== window && shouldTrackProgress;
    const shouldShowLocalProgress = window.parent === window && shouldTrackProgress;
    const studyPrefetcherService = servicesManager.services.studyPrefetcherService;

    if (
      !shouldTrackProgress ||
      !studyPrefetcherService?.getAggregateLoadingProgress ||
      (!shouldPostProgress && !shouldShowLocalProgress)
    ) {
      return;
    }

    const publishProgress = () => {
      const progress = studyPrefetcherService.getAggregateLoadingProgress();

      if (shouldShowLocalProgress) {
        setLocalProgress(progress);
      }

      if (shouldPostProgress) {
        window.parent.postMessage(
          {
            type: DICOM_PRELOAD_MESSAGE_TYPE,
            ...progress,
          },
          '*'
        );
      }
    };

    publishProgress();

    const subscriptions = [
      studyPrefetcherService.subscribe(
        studyPrefetcherService.EVENTS.SERVICE_STARTED,
        publishProgress
      ),
      studyPrefetcherService.subscribe(
        studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_PROGRESS,
        publishProgress
      ),
      studyPrefetcherService.subscribe(
        studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_COMPLETE,
        publishProgress
      ),
    ];

    return () => {
      subscriptions.forEach(subscription => subscription.unsubscribe());
    };
  }, [servicesManager]);

  const shouldShowLocalProgress = window.parent === window && shouldTrackDicomPreloadProgress();
  const preloadPercent = Math.round(Math.max(0, Math.min(localProgress.progress, 1)) * 100);

  if (!shouldShowLocalProgress || localProgress.isComplete) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 10000,
        width: 260,
        maxWidth: 'calc(100vw - 32px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        background: 'rgba(2, 6, 23, 0.95)',
        boxShadow: '0 18px 45px rgba(0, 0, 0, 0.35)',
        color: '#fff',
        padding: 12,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                border: '2px solid rgba(14, 165, 233, 0.25)',
                borderTopColor: '#0ea5e9',
                borderRadius: '999px',
                display: 'inline-block',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>Loading case images</p>
          </div>
          <p
            style={{
              margin: '4px 0 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'rgba(255, 255, 255, 0.65)',
              fontSize: 11,
            }}
          >
            {localProgress.totalImages > 0
              ? `${localProgress.loadedImages}/${localProgress.totalImages} slices`
              : 'Preparing image load...'}
          </p>
        </div>
        <p style={{ margin: 0, flexShrink: 0, fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
          {preloadPercent}%
        </p>
      </div>
      <div
        style={{
          height: 6,
          marginTop: 8,
          overflow: 'hidden',
          borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.1)',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 999,
            background: '#0ea5e9',
            transform: `scaleX(${preloadPercent / 100})`,
            transformOrigin: 'left center',
            transition: 'transform 300ms ease',
          }}
        />
      </div>
    </div>
  );
}

function App({
  config = {
    /**
     * Relative route from domain root that OHIF instance is installed at.
     * For example:
     *
     * Hosted at: https://ohif.org/where-i-host-the/viewer/
     * Value: `/where-i-host-the/viewer/`
     * */
    routerBasename: '/',
    /**
     *
     */
    showLoadingIndicator: true,
    showStudyList: true,
    oidc: [],
    extensions: [],
  },
  defaultExtensions = [],
  defaultModes = [],
}) {
  const [init, setInit] = useState(null);
  useEffect(() => {
    const run = async () => {
      appInit(config, defaultExtensions, defaultModes).then(setInit).catch(console.error);
    };

    run();
  }, []);

  if (!init) {
    return null;
  }

  // Set above for named export
  commandsManager = init.commandsManager;
  extensionManager = init.extensionManager;
  servicesManager = init.servicesManager;
  serviceProvidersManager = init.serviceProvidersManager;
  hotkeysManager = init.hotkeysManager;

  // Set appConfig
  const appConfigState = init.appConfig;
  const { routerBasename, modes, dataSources, oidc, showStudyList } = appConfigState;

  // get the maximum 3D texture size
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');

  if (gl) {
    const max3DTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    appConfigState.max3DTextureSize = max3DTextureSize;
  }

  const {
    uiDialogService,
    uiModalService,
    uiViewportDialogService,
    viewportGridService,
    cineService,
    userAuthenticationService,
    uiNotificationService,
    customizationService,
  } = servicesManager.services;

  const providers: any[] = [
    [AppConfigProvider, { value: appConfigState }],
    [UserAuthenticationProvider, { service: userAuthenticationService }],
    [I18nextProvider, { i18n }],
    [ThemeWrapperNext],
    [SystemContextProvider, { commandsManager, extensionManager, hotkeysManager, servicesManager }],
    [ViewportRefsProvider],
    [ViewportGridProvider, { service: viewportGridService }],
    [ViewportDialogProvider, { service: uiViewportDialogService }],
    [CineProvider, { service: cineService }],
    [NotificationProvider, { service: uiNotificationService }],
    [TooltipProvider],
    [DialogProvider, { service: uiDialogService, dialog: ManagedDialog }],
    [ModalProvider, { service: uiModalService, modal: ModalNext }],
    [ShepherdJourneyProvider],
  ];

  // Loop through and register each of the service providers registered with the ServiceProvidersManager.
  const providersFromManager = Object.entries(serviceProvidersManager.providers);
  if (providersFromManager.length > 0) {
    providersFromManager.forEach(([serviceName, provider]) => {
      providers.push([
        provider as React.ComponentType<any>,
        { service: servicesManager.services[serviceName] },
      ]);
    });
  }

  const CombinedProviders = ({ children }) => Compose({ components: providers, children });

  let authRoutes = null;

  // Should there be a generic call to init on the extension manager?
  customizationService.init(extensionManager);

  // Use config to create routes
  const appRoutes = createRoutes({
    modes,
    dataSources,
    extensionManager,
    servicesManager,
    commandsManager,
    hotkeysManager,
    routerBasename,
    showStudyList,
  });

  if (oidc) {
    authRoutes = (
      <OpenIdConnectRoutes
        oidc={oidc}
        routerBasename={routerBasename}
        userAuthenticationService={userAuthenticationService}
      />
    );
  }

  return (
    <CombinedProviders>
      <DicomPreloadProgressBridge servicesManager={servicesManager} />
      <BrowserRouter
        basename={routerBasename}
        future={routerFutureFlags}
      >
        {authRoutes}
        {appRoutes}
      </BrowserRouter>
    </CombinedProviders>
  );
}

App.propTypes = {
  config: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({
      routerBasename: PropTypes.string,
      oidc: PropTypes.array,
      whiteLabeling: PropTypes.object,
      extensions: PropTypes.array,
      showLoadingIndicator: PropTypes.bool,
      showStudyList: PropTypes.bool,
      modes: PropTypes.array,
      dataSources: PropTypes.array,
    }),
  ]),
  /* Extensions that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultExtensions: PropTypes.array,
  /* Modes that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultModes: PropTypes.array,
};

export default App;

export { commandsManager, extensionManager, servicesManager };
