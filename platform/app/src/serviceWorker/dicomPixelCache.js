/**
 * A persistent, byte-budgeted cache for DICOM pixel payloads, run inside the
 * viewer's service worker.
 *
 * Why this exists: the viewer is embedded by iframe in the review apps, and every
 * mount re-fetches the whole study. Pixel data is immutable per SOP Instance UID
 * (the illustrator's in-place re-save writes a NEW SOP UID), so once a frame has
 * crossed the wire it can be served locally from then on, with no network round
 * trip and no CORS preflight.
 *
 * What is deliberately NOT cached: study/series/instance metadata and searches.
 * Those change when series are added, deleted or replaced, and the users-be proxy
 * filters them differently per token purpose (candidates never see SR series or
 * descriptions), so they must always come from the network.
 *
 * Eviction is least-recently-used against a byte budget, never "drop everything"
 * on a quota error. Bookkeeping (size, last use) lives in IndexedDB because the
 * Cache API cannot report sizes or access times.
 */

const STORE = 'entries';
const DB_VERSION = 1;
const CACHED_AT_HEADER = 'x-re-cached-at';
const ACCEPT_KEY_PARAM = '__re_accept';
const TOUCH_FLUSH_DELAY_MS = 2000;
const BUDGET_SHARE_OF_QUOTA = 0.5;
const EVICT_DOWN_TO = 0.85;
const INFLIGHT_WAIT_MS = 10000;

const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 * 1024 * 1024;

/**
 * Pixel-bearing DICOMweb paths: frames, bulk data, rendered, or the whole
 * instance. `/metadata` is excluded on purpose (see header).
 */
const DICOMWEB_PIXEL_PATH =
  /\/dicom-web\/studies\/[^/]+\/series\/[^/]+\/instances\/[^/]+(?:\/(?:frames\/[^/]+|bulk(?:\/.*)?|rendered))?\/?$/i;

export function isDicomPixelRequest(request, url, origins) {
  if (request.method !== 'GET' || request.headers.has('range') || !origins.has(url.origin)) {
    return false;
  }

  const pathname = url.pathname;
  if (/\/wado\/?$/i.test(pathname)) {
    return (url.searchParams.get('requestType') || '').toUpperCase() === 'WADO';
  }

  return DICOMWEB_PIXEL_PATH.test(pathname);
}

/**
 * The cache key is the URL plus the Accept header. Two requests for one frame with
 * different transfer-syntax Accept values get different bodies, so they must not
 * share an entry. The marker parameter is never sent to a server.
 */
export function cacheKeyFor(request) {
  const url = new URL(request.url);
  const accept = request.headers.get('accept');
  if (accept) {
    url.searchParams.set(ACCEPT_KEY_PARAM, accept);
  }
  return url.toString();
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function isQuotaError(error) {
  return Boolean(
    error && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)
  );
}

function isStorable(response) {
  // `cors`/`basic` only: an opaque response hides its status and costs Chrome
  // ~7 MB of padded quota, so it must never be cached.
  return (
    response &&
    response.status === 200 &&
    (response.type === 'cors' || response.type === 'basic' || response.type === 'default')
  );
}

export function createDicomPixelCache({
  cacheName,
  dbName,
  origins,
  maxAgeMs = 30 * DAY_MS,
  maxBytes = 4 * GB,
  now = () => Date.now(),
}) {
  const originSet = new Set(origins);
  const inflight = new Map();
  const pendingTouches = new Map();
  let touchFlushPromise = null;
  let dbPromise = null;
  let totalBytesPromise = null;
  let commitQueue = Promise.resolve();

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('lastUsed', 'lastUsed');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch(error => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  async function readAllEntries() {
    const db = await openDb();
    return promisify(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  }

  function getTotalBytes() {
    if (!totalBytesPromise) {
      totalBytesPromise = readAllEntries()
        .then(entries => entries.reduce((total, entry) => total + (entry.size || 0), 0))
        .catch(error => {
          totalBytesPromise = null;
          throw error;
        });
    }
    return totalBytesPromise;
  }

  function adjustTotalBytes(delta) {
    totalBytesPromise = getTotalBytes().then(total => Math.max(0, total + delta));
    return totalBytesPromise;
  }

  async function getBudgetBytes() {
    try {
      const estimate = await self.navigator?.storage?.estimate?.();
      if (estimate?.quota) {
        return Math.min(maxBytes, Math.floor(estimate.quota * BUDGET_SHARE_OF_QUOTA));
      }
    } catch {
      // Fall through to the configured ceiling.
    }
    return maxBytes;
  }

  async function flushTouches() {
    if (pendingTouches.size === 0) {
      return;
    }
    const touches = Array.from(pendingTouches.entries());
    pendingTouches.clear();

    const db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const [key, lastUsed] of touches) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result) {
          store.put({ ...request.result, lastUsed });
        }
      };
    }
    await transactionDone(transaction);
  }

  /** Last-use times are batched: one IndexedDB write per burst, not per frame. */
  function touch(key, event) {
    pendingTouches.set(key, now());
    if (!touchFlushPromise) {
      touchFlushPromise = new Promise(resolve => setTimeout(resolve, TOUCH_FLUSH_DELAY_MS))
        .then(flushTouches)
        .catch(() => {})
        .finally(() => {
          touchFlushPromise = null;
        });
    }
    event?.waitUntil?.(touchFlushPromise);
  }

  async function forget(keys) {
    if (keys.length === 0) {
      return;
    }
    const db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let freed = 0;
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result) {
          freed += request.result.size || 0;
          store.delete(key);
        }
      };
    }
    await transactionDone(transaction);
    await adjustTotalBytes(-freed);

    const cache = await caches.open(cacheName);
    await Promise.all(keys.map(key => cache.delete(key)));
  }

  /** Evicts least-recently-used entries until at least `bytesToFree` is released. */
  async function evict(bytesToFree) {
    await flushTouches().catch(() => {});
    const db = await openDb();
    const transaction = db.transaction(STORE, 'readonly');
    const index = transaction.objectStore(STORE).index('lastUsed');
    const victims = [];
    let freed = 0;

    await new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || freed >= bytesToFree) {
          resolve();
          return;
        }
        victims.push(cursor.value.key);
        freed += cursor.value.size || 0;
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });

    await forget(victims);
    return freed;
  }

  async function record(key, size) {
    const db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const existing = await promisify(store.get(key));
    const timestamp = now();
    store.put({ key, size, cachedAt: timestamp, lastUsed: timestamp });
    await transactionDone(transaction);
    await adjustTotalBytes(size - (existing?.size || 0));
  }

  function toStoredResponse(blob, response) {
    const headers = new Headers(response.headers);
    // The body is already decoded and the key is exact, so these would only cause
    // false misses (Vary) or a wrong length (gzip at nginx).
    headers.delete('vary');
    headers.delete('content-encoding');
    headers.set('content-length', String(blob.size));
    headers.set(CACHED_AT_HEADER, String(now()));
    return new Response(blob, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /** Room-making, the put and the bookkeeping run one at a time so totals stay true. */
  function commit(key, blob, response) {
    const run = async () => {
      const cache = await caches.open(cacheName);
      const budget = await getBudgetBytes();
      if (blob.size > budget) {
        return;
      }

      const total = await getTotalBytes();
      if (total + blob.size > budget) {
        await evict(total + blob.size - Math.floor(budget * EVICT_DOWN_TO));
      }

      try {
        await cache.put(key, toStoredResponse(blob, response));
      } catch (error) {
        if (!isQuotaError(error)) {
          throw error;
        }
        // The browser's quota is tighter than our estimate: make real room and try once more.
        const current = await getTotalBytes();
        await evict(Math.max(blob.size * 2, Math.floor(current * 0.25)));
        await cache.put(key, toStoredResponse(blob, response));
      }

      await record(key, blob.size);
    };

    const result = commitQueue.then(run, run);
    commitQueue = result.catch(() => {});
    return result;
  }

  async function store(key, response) {
    const blob = await response.blob();
    await commit(key, blob, response);
  }

  async function matchFresh(cache, key) {
    const cached = await cache.match(key);
    if (!cached) {
      return undefined;
    }
    const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER)) || 0;
    if (now() - cachedAt > maxAgeMs) {
      await forget([key]).catch(() => {});
      return undefined;
    }
    return cached;
  }

  async function respond(request, event) {
    const key = cacheKeyFor(request);
    const cache = await caches.open(cacheName);

    const cached = await matchFresh(cache, key).catch(() => undefined);
    if (cached) {
      touch(key, event);
      return cached;
    }

    // The prefetcher and a viewport often ask for one frame at the same moment:
    // wait for the download already in flight instead of starting a second one.
    const pending = inflight.get(key);
    if (pending) {
      // Bounded: the first request settles only once its frame is stored, and a
      // stalled Cache or IndexedDB write must never leave this frame (and the
      // viewer's preload, which waits for every frame) hanging.
      await Promise.race([pending, new Promise(resolve => setTimeout(resolve, INFLIGHT_WAIT_MS))]);
      const shared = await matchFresh(cache, key).catch(() => undefined);
      if (shared) {
        touch(key, event);
        return shared;
      }
      return fetch(request);
    }

    let settle;
    inflight.set(
      key,
      new Promise(resolve => {
        settle = resolve;
      })
    );
    const release = () => {
      inflight.delete(key);
      settle();
    };

    let response;
    try {
      response = await fetch(request);
    } catch (error) {
      release();
      throw error;
    }

    if (!isStorable(response)) {
      release();
      return response;
    }

    const storing = store(key, response.clone())
      .catch(error => console.warn('DICOM cache: could not store a frame', error))
      .finally(release);
    event?.waitUntil?.(storing);
    return response;
  }

  /**
   * Run on activation: drops expired entries and reconciles the Cache with the
   * bookkeeping, so an entry neither side can account for never leaks quota.
   */
  async function maintain() {
    const cache = await caches.open(cacheName);
    const [entries, requests] = await Promise.all([readAllEntries(), cache.keys()]);
    const cachedKeys = new Set(requests.map(request => request.url));
    const knownKeys = new Set(entries.map(entry => entry.key));
    const cutoff = now() - maxAgeMs;

    const stale = entries
      .filter(entry => entry.cachedAt < cutoff || !cachedKeys.has(entry.key))
      .map(entry => entry.key);
    await forget(stale);

    const untracked = requests.filter(request => !knownKeys.has(request.url));
    await Promise.all(untracked.map(request => cache.delete(request)));

    totalBytesPromise = null;
  }

  return {
    matches: ({ request, url }) => isDicomPixelRequest(request, url, originSet),
    respond,
    maintain,
    // Exposed for tests and diagnostics.
    getTotalBytes,
    flushTouches,
  };
}
