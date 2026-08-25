(function () {
  var supportsServiceWorker = 'serviceWorker' in navigator;
  var hostname = location.hostname;
  var isLocalDevelopment =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname.indexOf('127.') === 0;

  if (!supportsServiceWorker || isLocalDevelopment) {
    return;
  }

  var refreshing = false;
  var swFileLocation = (window.PUBLIC_URL || '/') + 'sw.js';

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) {
      return;
    }

    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(swFileLocation)
      .then(function (registration) {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', function () {
          var newWorker = registration.installing;
          if (!newWorker) {
            return;
          }

          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(function (error) {
        console.warn('Service worker registration failed:', error);
      });
  });
})();
