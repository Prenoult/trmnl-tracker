// Minimal offline cache so the app still opens (with last-known data) without a connection.
const CACHE = "trmnl-tracker-v2";
const ASSETS = ["./", "index.html", "style.css", "app.js", "manifest.json", "icon.svg", "data/history.json"];

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
