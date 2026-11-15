/**
 * Background DICOM download for the review apps.
 *
 * The reviewer app (-fe) embeds dicom-prefetch.html in a hidden iframe and posts
 * one study at a time, each with its own short-lived viewer token. This page
 * fetches every image frame of the study and throws the bytes away: the point is
 * that the request passes through this origin's service worker, which stores the
 * frame in the pixel cache (dicomPixelCache.js). When the reviewer later opens
 * the study in a real viewer iframe, every frame is a local cache hit.
 *
 * Why a page of its own rather than a hidden viewer: a hidden OHIF instance
 * boots the whole app, decodes every frame and holds WebGL contexts, and Chrome
 * caps those per process (see the attempt page's mounted-viewer limit). This
 * page does none of that.
 *
 * The cache key is URL + Accept header, so frame requests here MUST be shaped
 * exactly like the viewer's:
 *   URL    `${wadoRoot}/studies/{study}/series/{series}/instances/{sop}/frames/{n}`
 *          (getWADORSImageId.js; n is 1-based, 1 for single-frame instances)
 *   Accept generateAcceptHeader(acceptHeader, requestTransferSyntaxUID,
 *          omitQuotationForMultipartRequest) from @ohif/core, fed by the default
 *          data source's config (initWADOImageLoader.js `beforeSend`).
 * If either changes in the viewer, change it here too, or the downloads land
 * under keys the viewer never reads.
 *
 * Messages (all `{ type: 'radiology-expertly:dicom-prefetch', ... }`):
 *   in   { command: 'enqueue', job: { id, token, studyInstanceUID } }
 *        { command: 'concurrency', value }  0 pauses, max 6
 *        { command: 'cancel' }              drops the queue and stops the job
 *   out  { event: 'ready' }
 *        { event: 'progress', id, loaded, total, failed }
 *        { event: 'done', id, status, loaded, total, failed }
 *          status: 'complete' | 'partial' | 'unauthorized' | 'not-found' | 'error'
 *
 * The DICOMweb root always comes from this origin's config, never from a
 * message, so an embedding page cannot point this page at another server.
 */
(function () {
  'use strict';

  var MESSAGE_TYPE = 'radiology-expertly:dicom-prefetch';
  var MAX_CONCURRENCY = 6;
  var CONTROLLER_WAIT_MS = 5000;
  var PROGRESS_INTERVAL_MS = 500;
  // Instances with no image frames of their own, or whose pixels the viewer
  // fetches another way (SEG/RT are loaded whole, not frame by frame).
  var NON_IMAGE_MODALITIES = [
    'SR',
    'SEG',
    'RTSTRUCT',
    'RTPLAN',
    'RTDOSE',
    'PR',
    'KO',
    'RWV',
    'DOC',
  ];

  if (window.parent === window) {
    return;
  }

  var config = window.config || {};
  var parentOrigin = null;
  var queue = [];
  var current = null;
  var concurrency = 3;

  function isLocalHost() {
    var hostname = window.location.hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.indexOf('127.') === 0;
  }

  /** Mirrors getEvaluationDicomWebRoot in DicomWebDataSource/index.ts. */
  function dicomWebRoot() {
    if (config.evaluationDicomWebRoot) {
      return String(config.evaluationDicomWebRoot).replace(/\/+$/, '');
    }
    if (isLocalHost()) {
      return 'http://localhost:8081/dicom-web';
    }
    return null;
  }

  function defaultDataSourceConfig() {
    var sources = Array.isArray(config.dataSources) ? config.dataSources : [];
    for (var i = 0; i < sources.length; i++) {
      if (sources[i] && sources[i].sourceName === config.defaultDataSourceName) {
        return sources[i].configuration || {};
      }
    }
    return {};
  }

  /** A copy of @ohif/core utils/generateAcceptHeader.ts (keep in step). */
  var TYPE_FOR_TS = {
    '*': 'application/octet-stream',
    '1.2.840.10008.1.2.1': 'application/octet-stream',
    '1.2.840.10008.1.2': 'application/octet-stream',
    '1.2.840.10008.1.2.2': 'application/octet-stream',
    '1.2.840.10008.1.2.4.70': 'image/jpeg',
    '1.2.840.10008.1.2.4.50': 'image/jpeg',
    '1.2.840.10008.1.2.4.51': 'image/dicom+jpeg',
    '1.2.840.10008.1.2.4.57': 'image/jpeg',
    '1.2.840.10008.1.2.5': 'image/dicom-rle',
    '1.2.840.10008.1.2.4.80': 'image/jls',
    '1.2.840.10008.1.2.4.81': 'image/jls',
    '1.2.840.10008.1.2.4.90': 'image/jp2',
    '1.2.840.10008.1.2.4.91': 'image/jp2',
    '1.2.840.10008.1.2.4.92': 'image/jpx',
    '1.2.840.10008.1.2.4.93': 'image/jpx',
  };

  function generateAcceptHeader(configAcceptHeader, requestTransferSyntaxUID, omitQuotation) {
    if (Array.isArray(configAcceptHeader) && configAcceptHeader.length > 0) {
      return configAcceptHeader;
    }
    var syntax = requestTransferSyntaxUID === undefined ? '*' : requestTransferSyntaxUID;
    var parts = ['multipart/related'];
    var hasTransferSyntax = false;
    if (syntax && TYPE_FOR_TS[syntax]) {
      parts.push('type=' + TYPE_FOR_TS[syntax]);
      parts.push('transfer-syntax=' + syntax);
      hasTransferSyntax = true;
    } else {
      parts.push('type=application/octet-stream');
    }
    if (!hasTransferSyntax) {
      parts.push('transfer-syntax=*');
    }
    if (!omitQuotation) {
      parts = parts.map(function (part) {
        if (part.indexOf('type=') === 0) {
          return 'type="' + part.substring(5) + '"';
        }
        if (part.indexOf('transfer-syntax=') === 0) {
          return 'transfer-syntax="' + part.substring(16) + '"';
        }
        return part;
      });
    }
    return [parts.join('; ')];
  }

  var sourceConfig = defaultDataSourceConfig();
  // `String([value])` is what XHR and fetch send for the viewer's one-entry array.
  var FRAME_ACCEPT = String(
    generateAcceptHeader(
      sourceConfig.acceptHeader,
      sourceConfig.requestTransferSyntaxUID,
      sourceConfig.omitQuotationForMultipartRequest
    )
  );

  /**
   * Frames only reach the pixel cache once the service worker controls this
   * page. The worker claims clients on activation, so on a first visit this
   * waits for the registration init-service-worker.js starts. Without a worker
   * (localhost, unsupported browser) the downloads still fill the HTTP cache,
   * which the viewer iframe shares.
   */
  var controllerReady = new Promise(function (resolve) {
    if (!('serviceWorker' in navigator) || isLocalHost() || navigator.serviceWorker.controller) {
      resolve();
      return;
    }
    var timer = setTimeout(resolve, CONTROLLER_WAIT_MS);
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      clearTimeout(timer);
      resolve();
    });
  });

  function post(message, targetOrigin) {
    var payload = Object.assign({ type: MESSAGE_TYPE }, message);
    window.parent.postMessage(payload, targetOrigin || parentOrigin || '*');
  }

  function tagValue(instance, tag) {
    var element = instance && instance[tag];
    if (!element || !Array.isArray(element.Value) || element.Value.length === 0) {
      return undefined;
    }
    return element.Value[0];
  }

  function frameUrlsFor(root, studyInstanceUID, instances) {
    var urls = [];
    for (var i = 0; i < instances.length; i++) {
      var instance = instances[i];
      var modality = String(tagValue(instance, '00080060') || '').toUpperCase();
      var rows = tagValue(instance, '00280010');
      var sopInstanceUID = tagValue(instance, '00080018');
      var seriesInstanceUID = tagValue(instance, '0020000E');
      if (
        !rows ||
        !sopInstanceUID ||
        !seriesInstanceUID ||
        NON_IMAGE_MODALITIES.indexOf(modality) !== -1
      ) {
        continue;
      }
      var frames = parseInt(tagValue(instance, '00280008'), 10);
      if (!(frames > 0)) {
        frames = 1;
      }
      var base =
        root +
        '/studies/' +
        studyInstanceUID +
        '/series/' +
        seriesInstanceUID +
        '/instances/' +
        sopInstanceUID +
        '/frames/';
      for (var frame = 1; frame <= frames; frame++) {
        urls.push(base + frame);
      }
    }
    return urls;
  }

  function statusFor(httpStatus) {
    if (httpStatus === 401 || httpStatus === 403) {
      return 'unauthorized';
    }
    if (httpStatus === 404) {
      return 'not-found';
    }
    return 'error';
  }

  async function runJob(job) {
    var root = dicomWebRoot();
    var state = { id: job.id, loaded: 0, total: 0, failed: 0, stopped: null, cancelled: false };
    current = state;
    if (!root) {
      return Object.assign(state, { status: 'error' });
    }

    await controllerReady;
    var authorization = 'Bearer ' + job.token;

    var metadata;
    try {
      var response = await fetch(root + '/studies/' + job.studyInstanceUID + '/metadata', {
        headers: { Accept: 'application/dicom+json', Authorization: authorization },
      });
      if (!response.ok) {
        return Object.assign(state, { status: statusFor(response.status) });
      }
      metadata = await response.json();
    } catch (error) {
      return Object.assign(state, { status: 'error' });
    }

    var urls = frameUrlsFor(root, job.studyInstanceUID, Array.isArray(metadata) ? metadata : []);
    state.total = urls.length;
    var lastProgressAt = 0;

    function reportProgress(force) {
      var now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) {
        return;
      }
      lastProgressAt = now;
      post({
        event: 'progress',
        id: state.id,
        loaded: state.loaded,
        total: state.total,
        failed: state.failed,
      });
    }
    reportProgress(true);

    async function download(url) {
      try {
        var frameResponse = await fetch(url, {
          headers: { Accept: FRAME_ACCEPT, Authorization: authorization },
        });
        if (!frameResponse.ok) {
          state.failed++;
          if (frameResponse.status === 401 || frameResponse.status === 403) {
            // The token expired or was refused; the host mints a new one and
            // re-sends the study. Frames already stored are cache hits then.
            state.stopped = 'unauthorized';
          }
          return;
        }
        // Read the body to the end so the worker's copy completes and is stored.
        await frameResponse.arrayBuffer();
        state.loaded++;
      } catch (error) {
        state.failed++;
      }
      reportProgress(false);
    }

    await new Promise(function (resolve) {
      var index = 0;
      var active = 0;
      function pump() {
        var halted = state.cancelled || state.stopped;
        while (!halted && active < concurrency && index < urls.length) {
          var url = urls[index++];
          active++;
          download(url).then(function () {
            active--;
            pump();
          });
        }
        if (active === 0 && (halted || index >= urls.length)) {
          state.wake = null;
          resolve();
        }
      }
      state.wake = pump;
      pump();
    });

    reportProgress(true);
    var status = state.cancelled
      ? 'error'
      : state.stopped || (state.failed === 0 ? 'complete' : 'partial');
    return Object.assign(state, { status: status });
  }

  async function drain() {
    if (current || queue.length === 0) {
      return;
    }
    var job = queue.shift();
    var result = await runJob(job);
    current = null;
    post({
      event: 'done',
      id: result.id,
      status: result.status,
      loaded: result.loaded,
      total: result.total,
      failed: result.failed,
    });
    drain();
  }

  function isValidJob(job) {
    return (
      job &&
      typeof job.id === 'string' &&
      typeof job.token === 'string' &&
      job.token.length > 0 &&
      typeof job.studyInstanceUID === 'string' &&
      /^[0-9.]+$/.test(job.studyInstanceUID)
    );
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }
    var data = event.data;
    if (!data || data.type !== MESSAGE_TYPE) {
      return;
    }
    // Replies, which carry progress for the host's studies, go only to the
    // origin that first talked to this page.
    if (parentOrigin === null) {
      parentOrigin = event.origin;
    } else if (event.origin !== parentOrigin) {
      return;
    }

    if (data.command === 'enqueue' && isValidJob(data.job)) {
      queue.push({
        id: data.job.id,
        token: data.job.token,
        studyInstanceUID: data.job.studyInstanceUID,
      });
      drain();
    } else if (data.command === 'concurrency') {
      var value = Number(data.value);
      concurrency = Math.max(0, Math.min(MAX_CONCURRENCY, Math.floor(value) || 0));
      if (current && current.wake) {
        current.wake();
      }
    } else if (data.command === 'cancel') {
      queue = [];
      if (current) {
        current.cancelled = true;
        if (current.wake) {
          current.wake();
        }
      }
    }
  });

  post({ event: 'ready' }, '*');
})();
