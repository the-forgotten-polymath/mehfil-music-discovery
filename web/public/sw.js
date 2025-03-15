/**
 * Minimal service worker.
 *
 * Two jobs: make the app installable (Chromium withholds
 * `beforeinstallprompt` unless a worker with a fetch handler is registered),
 * and keep it usable offline — without ever pinning a user to an old build.
 *
 * The caching split is the important part:
 *
 *   /_next/static/*  cache-first. Fingerprinted by the build, so a given URL
 *                    can never point at different bytes. Safe to keep forever.
 *
 *   everything else  network-first, cache only as an offline fallback. The
 *                    catalogue, portraits and icons all live at stable URLs
 *                    that change contents between deploys, so caching them
 *                    first would strand installed users on a stale catalogue
 *                    with no way to recover.
 *
 * Caches are named for the build, and every other build's cache is dropped on
 * activation, so a new worker never inherits entries written by an older one.
 *
 * The worker is registered at /sw.js?v=<build> for that to work at all: a
 * service worker is only replaced when its own bytes change, and this file is
 * static. Without the query the browser found no difference between deploys,
 * never installed a new worker, and so never ran the activation that clears
 * anything — leaving installed apps on a complete, working, stale build.
 */

/**
 * Cache named for the build that created it.
 *
 * The worker is registered as /sw.js?v=<build>, so this script's own URL
 * carries the version. That gives two things: the browser sees a different
 * worker on every deploy and therefore actually installs one, and each build's
 * entries are segregated rather than sharing a name across versions.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `mehfil-${VERSION}`;
const IMMUTABLE = /^\/_next\/static\//;

self.addEventListener("install", () => {
  // Don't wait for every existing tab to close before taking over.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Every cache but this build's. Dropping ours too would throw away
      // entries this worker has just been serving from.
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// A waiting worker can be told to take over. skipWaiting on install already
// does this, so it is a backstop for the case where one is left waiting.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intervene in YouTube or Wikimedia requests.
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  const isNavigation = request.mode === "navigate";

  // Network first: the network's answer always wins when it is reachable, so
  // a deploy is picked up on the next load rather than whenever a cache
  // happens to expire.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          // Navigations are stored under a fixed key. Keying them by URL would
          // file "/?x=1" separately, and the offline fallback below — which
          // can only ask for one thing — would then miss.
          caches.open(CACHE).then((c) => c.put(isNavigation ? "/" : request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(isNavigation ? "/" : request)
          .then((hit) => hit ?? Response.error())
      )
  );
});
