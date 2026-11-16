/* Scripture Hunt service worker.
 *
 * Strategy: precache the shell + puzzle data so the game works offline, then serve
 * network-first for navigation (so a deploy is picked up on the next launch) and
 * cache-first for the immutable assets.
 *
 * Bump CACHE when the shell changes in a way that must not survive a stale cache.
 */
const CACHE = "scripture-hunt-v2";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/data/puzzles.json",
  "/data/pool_final.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if one entry 404s, so tolerate individual misses.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never intercept third-party (Stripe)

  // The static verse pages under /v/ must be served exactly as published: they exist for search
  // engines and carry their own title/description/canonical. Falling back to the app shell would
  // silently replace them with a random-verse page and destroy what the crawler indexes.
  if (url.pathname.startsWith("/v/")) return;

  // Navigations: try the network so a new deploy lands, fall back to the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Assets: cache-first, refresh in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
