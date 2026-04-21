// FitTrack Service Worker
// Cache-first strategy for app shell; network-first for CDN assets.

const CACHE_NAME    = 'fittrack-v1';
const CDN_CACHE     = 'fittrack-cdn-v1';

const APP_SHELL = [
  './fitness_tracker.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// ── Install: pre-cache app shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        // addAll fails if any request fails; use individual puts to be resilient
        return Promise.allSettled(
          APP_SHELL.map(url =>
            fetch(url).then(res => {
              if (res.ok) cache.put(url, res);
            }).catch(() => {/* file may not exist yet */})
          )
        );
      }),
      caches.open(CDN_CACHE).then(cache => {
        return Promise.allSettled(
          CDN_ASSETS.map(url =>
            fetch(url, { mode: 'cors' }).then(res => {
              if (res.ok) cache.put(url, res);
            }).catch(() => {/* offline during install */})
          )
        );
      }),
    ])
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────
self.addEventListener('activate', event => {
  const valid = [CACHE_NAME, CDN_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !valid.includes(k)).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache with network fallback ─────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // CDN resources: cache-first, update in background
  if (url.hostname.includes('jsdelivr') || url.hostname.includes('cdnjs')) {
    event.respondWith(cdnStrategy(request));
    return;
  }

  // App shell: cache-first
  if (url.origin === self.location.origin || request.url.startsWith('./')) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

// Cache-first: serve cached, fall back to network, cache new response
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return a minimal offline fallback for navigation requests
    if (request.mode === 'navigate') {
      const shell = await caches.match('./fitness_tracker.html');
      if (shell) return shell;
    }
    return new Response('Offline — open the app while connected first.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// CDN: cache-first, then update in background (stale-while-revalidate)
async function cdnStrategy(request) {
  const cached = await caches.match(request);

  const networkFetch = fetch(request, { mode: 'cors' }).then(response => {
    if (response.ok) {
      caches.open(CDN_CACHE).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || await networkFetch || new Response('', { status: 503 });
}
