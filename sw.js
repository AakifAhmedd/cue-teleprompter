/* CUE service worker — network-first with a short timeout, then cache.
   A flaky venue connection must never delay opening the app on stage, so
   after 3s we serve the cached copy while the network fetch keeps updating
   the cache in the background. Only this app's own files are cached. */
const SCOPE = new URL(self.registration.scope);
const CACHE = 'cue-shell-v1:' + SCOPE.pathname;
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('./index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load the app shell');
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="((?:css|js|icons)\/[^"]+)"/g)].map(m => m[1]);
    await cache.addAll(['./', './index.html', './VERSION', './manifest.webmanifest',
      './icons/icon-192.png', './icons/icon-512.png', ...assets]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  // CacheStorage is shared with other apps on this origin; never delete theirs.
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  // VERSION is requested with a changing query; cache it under one key.
  const key = url.pathname === SCOPE.pathname + 'VERSION' ? url.origin + url.pathname : req;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE).catch(() => null);
    const network = fetch(req).then(async (res) => {
      if (cache && res.ok) { try { await cache.put(key, res.clone()); } catch (_) { /* best-effort */ } }
      return res;
    });
    e.waitUntil(network.catch(() => {}));

    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
    const fresh = await Promise.race([network.catch(() => null), timeout]);
    if (fresh) return fresh;

    const hit = cache && await cache.match(key);
    if (hit) return hit;
    if (cache && req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return network; // nothing cached: wait for the network (or fail honestly)
  })());
});
