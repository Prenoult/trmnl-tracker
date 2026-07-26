// Minimal offline cache so the app still opens (with last-known data) without a connection.
// Bump CACHE whenever ASSETS changes, or clients keep serving the old bundle.
// app.js is an ES module: every file it imports has to be listed too, otherwise
// the page loads from cache and then dies on a failed import. test/assets.test.js
// enforces that.
const CACHE = "trmnl-tracker-v4";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "lib/config.js",
  "lib/domain.js",
  "lib/chart-model.js",
  "lib/history.js",
  "manifest.json",
  "icon.svg",
  "icon-180.png",
  "icon-512.png",
  "data/history.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isHistory = url.pathname.endsWith("data/history.json");

  if (isHistory) {
    // Network-first for the data file so a fresh daily snapshot shows up immediately.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
