// Service worker mínimo para habilitar instalación PWA.
const CACHE = "jm-cache-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  const scope = self.registration.scope;
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([scope, scope + "manifest.webmanifest"]).catch(() => {})),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first con fallback a cache (necesario para que cuente como instalable).
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Las llamadas a la API (otro origen: ORDS) nunca se cachean: siempre en vivo.
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match(self.registration.scope))),
  );
});
