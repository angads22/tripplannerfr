"use strict";

// Pitstop service worker — gives the app installability + a basic offline shell
// WITHOUT ever serving a stale build. The app self-updates and sends no-store on
// HTML/JS, so this SW is deliberately NETWORK-FIRST: it always tries the network
// and only falls back to cache when offline. The API is never cached.

var CACHE = "pitstop-v1";

// Pre-cache the minimal shell so a cold offline launch still shows something.
var SHELL = ["/", "/css/pitstop.css", "/js/app.js", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", function (e) {
  // Activate this build immediately rather than waiting for old tabs to close.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
});

self.addEventListener("activate", function (e) {
  // Drop caches from previous versions and take control of open pages.
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return; // never cache writes
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (fonts) pass through
  // Never cache the API — always live, and offline data would be misleading.
  if (url.pathname.startsWith("/api/")) return;

  // Network-first: try the network, cache a copy on success, fall back to the
  // cached copy only when the network is unavailable.
  e.respondWith(
    fetch(req)
      .then(function (resp) {
        if (resp && resp.status === 200 && resp.type === "basic") {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("/"); // last resort: the app shell
        });
      })
  );
});
