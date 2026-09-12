/*
 * Bounded offline shell for the public browser demo.
 *
 * This file is intentionally dependency-free: it is copied into the /try
 * artifact and must remain loadable when the application chunks are stale.
 * The worker never handles cross-origin requests, never caches itself, and
 * only activates a waiting update after the page asks it to do so.
 */

const CACHE_NAME = 'varve-demo-shell-v1';
const MAX_CACHE_ENTRIES = 256;

function isCacheableRequest(request) {
  return (
    request.method === 'GET' &&
    new URL(request.url).origin === self.location.origin &&
    request.url !== self.location.href
  );
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHE_ENTRIES;
  for (let index = 0; index < excess; index += 1) {
    const key = keys[index];
    if (key) await cache.delete(key);
  }
}

async function cacheResponse(request, response) {
  if (!response.ok) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  await trimCache(cache);
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    return await cacheResponse(request, await fetch(request));
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match(new URL('./', self.registration.scope).href)) ||
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    return await cacheResponse(request, await fetch(request));
  } catch {
    return Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // The first online load is the setup step. If it is interrupted, the
      // worker still installs and a later request can populate the cache.
      try {
        const shell = new URL('./', self.registration.scope).href;
        await cache.add(shell);
      } catch {
        // Offline-first is best effort until the shell has been loaded once.
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('varve-demo-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'VARVE_DEMO_ACTIVATE_UPDATE') {
    void self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!isCacheableRequest(request)) return;

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (['script', 'style', 'font', 'image', 'wasm'].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});
