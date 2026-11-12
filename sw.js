// sw.js — lets the loom open without internet after the first visit.
// It keeps a copy of the app's own files on the device. Nothing else is stored,
// and nothing is sent anywhere.
//
// How updates work: with internet, the newest version is always loaded (and the
// saved copy refreshed). Without internet, the saved copy is used.

const CACHE = "two-hand-loom-v4";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./loom.js",
  "./fonts/Literata.woff2",
  "./fonts/AtkinsonHyperlegibleNext.woff2",
  "./manifest.webmanifest",
  "./icon.svg",
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
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      }
      return res;
    }).catch(function () {
      // offline: use the saved copy (ignoring ?mode=exhibition etc. in the address)
      return caches.open(CACHE).then(function (cache) {
        return cache.match(event.request, { ignoreSearch: true });
      });
    })
  );
});
