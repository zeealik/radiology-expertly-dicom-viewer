// https://developers.google.com/web/tools/workbox/guides/troubleshoot-and-debug
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

// Install newest
// https://developers.google.com/web/tools/workbox/modules/workbox-core
self.skipWaiting();
workbox.core.clientsClaim();

const DICOM_RESPONSE_CACHE = 'radiology-dicom-responses-v1';
const DICOM_CACHEABLE_ORIGINS = new Set([
  'https://api-viewer.radiologyexpertly.com',
  'https://api.radiologyexpertly.com',
]);

const isDicomPixelRequest = ({ request, url }) => {
  if (request.method !== 'GET' || !DICOM_CACHEABLE_ORIGINS.has(url.origin)) {
    return false;
  }

  const pathname = url.pathname.toLowerCase();
  if (pathname.includes('/orthanc/wado')) {
    return url.searchParams.get('requestType')?.toUpperCase() === 'WADO';
  }

  const isDicomWebPath =
    pathname.includes('/dicom-web/') || pathname.includes('/orthanc/dicom-web/');
  const retrievesInstance = pathname.includes('/instances/');

  return isDicomWebPath && retrievesInstance;
};

// Cache static assets that aren't precached
workbox.routing.registerRoute(
  /\.(?:js|css|json5)$/,
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: 'static-resources',
  })
);

// Cache the Google Fonts stylesheets with a stale-while-revalidate strategy.
workbox.routing.registerRoute(
  /^https:\/\/fonts\.googleapis\.com/,
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: 'google-fonts-stylesheets',
  })
);

// Cache the underlying font files with a cache-first strategy for 1 year.
workbox.routing.registerRoute(
  /^https:\/\/fonts\.gstatic\.com/,
  new workbox.strategies.CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 Year
        maxEntries: 30,
      }),
    ],
  })
);

// Cache immutable DICOM pixel payloads across refreshes so a candidate does not
// have to download the full case again after the browser reloads the viewer.
workbox.routing.registerRoute(
  isDicomPixelRequest,
  new workbox.strategies.CacheFirst({
    cacheName: DICOM_RESPONSE_CACHE,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24,
        maxEntries: 4000,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// MESSAGE HANDLER
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;

      default:
        console.warn(`SW: Invalid message type: ${event.data.type}`);
    }
  }
});

workbox.precaching.precacheAndRoute(self.__WB_MANIFEST);

// TODO: Cache API
// https://developers.google.com/web/fundamentals/instant-and-offline/web-storage/cache-api
// Store DICOMs?
// Clear Service Worker cache?
// navigator.storage.estimate().then(est => console.log(est)); (2GB?)
