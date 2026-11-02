'use strict';

const SHELL_CACHE = 'kiemke-shell-v46.0.0-production';
const SHELL_FILES = [
  './',
  './index.php',
  './assets/css/style.css?v=46.0.0',
  './assets/js/offline-cache.js?v=46.0.0',
  './assets/js/app.js?v=46.0.0',
  './assets/vendor/jsQR.min.js?v=46.0.0'
];

const NEVER_CACHE = [
  'api.php',
  'machine_api.php',
  'asset_import_api.php',
  'ocr_api.php',
  'qr_decode_api.php',
  'export_excel.php'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isNeverCacheUrl(url) {
  return NEVER_CACHE.some(name => url.pathname.endsWith('/' + name) || url.pathname.endsWith(name));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isNeverCacheUrl(url)) return;

  // Page navigation: prefer fresh server page, but allow reopening the already-used app offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put('./index.php', clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.php').then(r => r || caches.match('./')))
    );
    return;
  }

  // Same-origin app assets: cache first, refresh in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        const refresh = fetch(request).then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => null);
        return cached || refresh;
      })
    );
    return;
  }

  // Cross-origin libraries remain network controlled. Overview/API responses are never cached here.
});
