/* Wally's service worker: the app opens full screen from the home screen, and still opens offline.
   Pages, scripts and styles come from the server, checked against what the browser has (a quick
   304 when nothing changed), so every file is from the same version after an upgrade. The cache
   is only for when the server can't be reached. Money (/api) always goes to the server. */
const CACHE = "wally-2.0.1";
const SHELL = ["/", "/index.html", "/css/wally.css", "/css/app.css", "/js/app.js", "/js/core.js", "/js/ui.js", "/js/shell.js", "/fonts/Geist-Variable.woff2", "/icons/mark-64.png", "/manifest.webmanifest"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Every page of the app is the same document
  const key = ev.request.mode === "navigate" ? "/index.html" : ev.request;
  ev.respondWith(
    caches.open(CACHE).then((cache) =>
      fetch(ev.request, { cache: "no-cache" }).then((r) => {
        if (r.ok && r.type === "basic") cache.put(key, r.clone());
        return r;
      }).catch(async () => (await cache.match(key)) || Response.error())
    )
  );
});
