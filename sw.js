// Minimal offline cache so the app still opens (with last-known data) without a connection.
// Bump CACHE whenever ASSETS changes, or clients keep serving the old bundle.
// app.js is an ES module: every file it imports has to be listed too, otherwise
// the page loads from cache and then dies on a failed import. test/assets.test.js
// enforces that.
const CACHE = "trmnl-tracker-v10";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "lib/config.js",
  "lib/domain.js",
  "lib/chart-model.js",
  "lib/queue-model.js",
  "lib/calendar-model.js",
  "lib/history.js",
  "lib/status.js",
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
  // status.json gets the same treatment as history.json, but is deliberately not
  // in ASSETS above: it does not exist until the order ships, and cache.addAll
  // fails outright on any 404 in the list, which would break the whole precache.
  const isDataFile =
    url.pathname.endsWith("data/history.json") || url.pathname.endsWith("data/status.json");

  if (isDataFile) {
    // Network-first for the data files so a fresh daily snapshot — or the
    // shipped flag — shows up immediately.
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
