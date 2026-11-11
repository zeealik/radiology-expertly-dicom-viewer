// The viewer's service worker exists to make re-opening a study fast: the viewer is
// embedded by iframe in the review and pilot-study apps, and every mount used to
// re-download every frame.
//
// Workbox is bundled from node_modules (not importScripts from Google's CDN): that
// host is unreachable from some networks, and when it fails the worker never
// installs, which silently turned the whole DICOM cache off.
import { clientsClaim } from 'workbox-core';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { createDicomPixelCache } from './serviceWorker/dicomPixelCache';

const DICOM_PIXEL_CACHE = 'radiology-dicom-pixels-v2';
const DICOM_PIXEL_DB = 'radiology-dicom-pixels';
const APP_ASSET_CACHE = 'radiology-viewer-assets-v1';
const DICOM_ORIGINS = [
  'https://api-viewer.radiologyexpertly.com',
  'https://api.radiologyexpertly.com',
];

// Caches written by earlier versions of this worker. The precache alone held about
// 160 MB of bundles, wasm and source maps the viewer never loads.
const LEGACY_CACHE_NAMES = ['radiology-dicom-responses-v1', 'static-resources'];
const LEGACY_CACHE_PREFIXES = ['workbox-precache'];

// Precaching is deliberately off. It downloaded the whole build on first visit and
// again on every deploy, competing with DICOM downloads, and on a slow link the
// install could fail outright. Hashed bundles are cached as they are used instead.
// The manifest reference must stay so InjectManifest has its injection point.
void self.__WB_MANIFEST;

self.skipWaiting();
clientsClaim();

const dicomPixelCache = createDicomPixelCache({
  cacheName: DICOM_PIXEL_CACHE,
  dbName: DICOM_PIXEL_DB,
  origins: DICOM_ORIGINS,
});

registerRoute(dicomPixelCache.matches, ({ request, event }) =>
  dicomPixelCache.respond(request, event)
);

// Content-hashed bundles and wasm never change under the same name, so they are
// served from cache with no revalidation round trip.
const HASHED_APP_ASSET = /(?:\.[0-9a-f]{16,}\.(?:js|css)|\/[0-9a-f]{16,}\.wasm)$/i;
registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    HASHED_APP_ASSET.test(url.pathname),
  new CacheFirst({
    cacheName: APP_ASSET_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 30,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

registerRoute(
  /^https:\/\/fonts\.googleapis\.com/,
  new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' })
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com/,
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 }),
    ],
  })
);

async function deleteLegacyCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter(
        name =>
          LEGACY_CACHE_NAMES.includes(name) ||
          LEGACY_CACHE_PREFIXES.some(prefix => name.startsWith(prefix))
      )
      .map(name => caches.delete(name))
  );
}

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      deleteLegacyCaches(),
      dicomPixelCache.maintain().catch(error => console.warn('DICOM cache maintenance', error)),
    ])
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
