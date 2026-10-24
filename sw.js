/* CUE service worker. Each asset token gets a complete offline shell.
   Online navigation never overwrites that shell with HTML whose scripts
   might not be cached yet. A flaky venue connection falls back after 3s. */
const SCOPE = new URL(self.registration.scope);
const PREFIX = 'cue-shell-v2:' + SCOPE.pathname + ':';
const RELEASE = new URL(self.location.href).searchParams.get('v');
const CACHE = PREFIX + (RELEASE || 'initial');
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const response = await fetch('./index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load the app shell');
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="((?:css|js|icons)\/[^"]+)"/g)].map(m => m[1]);
    // A deployment changing during installation must not create a mixed shell.
    if (RELEASE && assets.some(path => /^(css|js)\//.test(path) && new URL(path, SCOPE).searchParams.get('v') !== RELEASE)) {
      throw new Error('App assets changed during installation');
    }
    const cache = await caches.open(CACHE);
    await cache.addAll(['./VERSION', './manifest.webmanifest',
      './icons/icon-192.png', './icons/icon-512.png', ...assets]);
    await cache.put('./index.html', response.clone());
    await cache.put('./', response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // CacheStorage is shared with other apps on this origin; only clean up CUE's scope.
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE &&
      (key.startsWith(PREFIX) || key === 'cue-shell-v1:' + SCOPE.pathname)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const isVersion = url.pathname === SCOPE.pathname + 'VERSION';
  const key = isVersion ? url.origin + url.pathname : req;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE).catch(() => null);
    let hit = cache && await cache.match(key);
    if (!hit && cache && req.mode === 'navigate') hit = await cache.match('./index.html');
    // Tokened assets are immutable within a release. Only navigation and VERSION need the network.
    if (hit && req.mode !== 'navigate' && !isVersion) return hit;
    const network = fetch(req).catch(() => null);
    let timer;
    try {
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS); });
      const fresh = await Promise.race([network, timeout]);
      if (fresh && fresh.ok) return fresh;
      if (hit) return hit;
      return fresh || await network || Response.error();
    } finally { clearTimeout(timer); }
  })());
});
