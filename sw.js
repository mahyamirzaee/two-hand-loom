// sw.js — lets the loom open without internet after the first visit.
// It keeps a copy of the app's own files on the phone. Nothing else is stored,
// and nothing is sent anywhere.
//
// How updates work: the phone shows the saved copy at once, and quietly
// fetches the newest version in the background for next time.

const CACHE = "two-hand-loom-v1";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./loom.js",
  "./fonts/Literata.woff2",
  "./fonts/AtkinsonHyperlegibleNext.woff2",
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE; })
        .map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(event.request).then(function (saved) {
        const fresh = fetch(event.request).then(function (res) {
          if (res && res.ok) cache.put(event.request, res.clone());
          return res;
        }).catch(function () { return saved; });
        return saved || fresh;
      });
    })
  );
});
