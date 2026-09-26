// Offline support. Pages and files come from the network whenever possible, so
// updates show up right away; the saved copies are only used when offline.
const CACHE = 'organizer';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Save the page plus every file it links to, including their ?v= versions.
    const res = await fetch('./', { cache: 'no-cache' });
    await cache.put('./', res.clone());
    const html = await res.text();
    const files = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
    await cache.addAll(files);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (cached) return cached;
      throw err;
    }
  })());
});
