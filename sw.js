// App-shell service worker, merged with OneSignal's push worker per their
// documented "existing service worker" coexistence pattern: importScripts
// loads OneSignal's install/activate/push/notificationclick listeners into
// this same worker (addEventListener supports multiple listeners per event,
// so neither side overrides the other). The client points OneSignal at this
// exact file via serviceWorkerPath: "sw.js" instead of its own default
// OneSignalSDKWorker.js, so there's only ever one registration/scope.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Bump CACHE_NAME whenever the precache list below changes, so the old
// cache gets cleaned up on activate instead of accumulating stale entries.
const CACHE_NAME = "msa-shell-v2";

const PRECACHE_URLS = [
  "index.html",
  "exec.html",
  "manifest.json",
  "assets/css/app.css?v=4",
  "assets/js/reader.js?v=2",
  "assets/js/exec.js?v=4",
  "assets/js/install.js?v=1",
  "assets/js/notify.js?v=1",
  "assets/js/sw-register.js?v=1",
  "assets/js/icons.js?v=4",
  "assets/js/shared.js",
  "assets/js/config.js",
  "assets/js/supabase-client.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-192.png",
  "assets/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Per-file, not cache.addAll(): addAll is atomic, so one stale/missing
      // entry in PRECACHE_URLS (e.g. after forgetting to bump a ?v= here)
      // would otherwise fail the whole install and skipWaiting() never runs.
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
      .then((results) => {
        results.forEach((r, i) => {
          if (r.status === "rejected") console.error("[sw] precache failed:", PRECACHE_URLS[i], r.reason);
        });
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept Supabase/Google Fonts calls

  // Page navigations: network-first, so a deployed update is picked up
  // immediately when online; cached shell is only a fallback when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("index.html")))
    );
    return;
  }

  // Static app-shell assets: cache-first (each already cache-busted via its
  // own ?v= query when it changes), falling back to network and filling the
  // cache for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
