(function () {
  var supportsServiceWorker = 'serviceWorker' in navigator;
  var hostname = location.hostname;
  var isLocalDevelopment =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname.indexOf('127.') === 0;

  if (!supportsServiceWorker || isLocalDevelopment) {
    return;
  }

  var swFileLocation = (window.PUBLIC_URL || '/') + 'sw.js';

  // No reload on `controllerchange`. The worker only caches DICOM pixels and
  // content-hashed bundles; it never serves a different app version, so a new
  // worker can take over a running viewer safely. The old reload restarted every
  // embedded viewer on first visit and after every deploy, mid-review, and threw
  // away the frames it had just downloaded.
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(swFileLocation)
      .then(function (registration) {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      })
      .catch(function (error) {
        console.warn('Service worker registration failed:', error);
      });
  });
})();
