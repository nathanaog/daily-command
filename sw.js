/* The Natto App — service worker
 * Job: make the app open instantly and work offline.
 *  - App shell (index.html, manifest, icons): stale-while-revalidate.
 *    You get the cached copy immediately; a fresh copy is fetched in the
 *    background and used next time (the app shows "New version ready").
 *  - Data files (digest.json, feeds.json, briefing.*): network-first,
 *    falling back to the last cached copy when offline (Stage 3).
 *  - Cross-origin requests (weather, Google APIs) are not touched; the
 *    app keeps its own "last known" copies in localStorage.
 * Bump VERSION whenever you change this file or the shell list.
 */
const VERSION = 'dc-v1.10.0';
const SHELL = ['./', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
const DATA = /\/(digest|feeds|config)\.json$|\/briefing\.(md|json)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page asks us to activate a waiting update ("Reload" in the toast).
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // leave other origins alone

  if (DATA.test(url.pathname)) {                                         // network-first for data
    const key = url.origin + url.pathname;                               // one cached copy per file, whatever the query string
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key)
      .then(r => r || new Response('{"offline":true}', { headers: { 'Content-Type': 'application/json' } }))));
    return;
  }

  // App shell: stale-while-revalidate. Navigations (any URL/hash/query) map to index.html.
  const key = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});

// Tapping a notification focuses the app (or opens it).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
