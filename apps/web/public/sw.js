/**
 * The service worker: what makes the game installable, and what makes a second
 * visit fast.
 *
 * Deliberately runtime-cache only, with no precache list. The client ships 2 MB
 * of physics wasm, a wardrobe, a bestiary and forty textures; precaching that on
 * first paint would spend the player's connection on assets they may never reach
 * while the menu is still waiting for its own art. Everything is cached the
 * first time it is actually asked for, which is also the only honest signal of
 * what this player uses.
 *
 * Network-first for the document so a deploy is never one refresh behind, and
 * cache-first for everything else because every other file is content-hashed by
 * Vite or is a texture that does not change without changing its name.
 *
 * Registered only in a production build (`main.tsx`): a worker serving stale
 * modules under Vite's dev server is a debugging session nobody asked for.
 */
const CACHE = "exiled-v1";

self.addEventListener("install", (event) => {
  // No waiting: an update should take over on the next load, not the load after.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          // Opaque and error responses are not worth keeping: a cached 404 is a
          // file that stays broken until the cache version changes.
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
