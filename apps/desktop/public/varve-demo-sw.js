/*
 * Bounded offline shell for the public browser demo.
 *
 * This file is intentionally dependency-free: it is copied into the /try
 * artifact and must remain loadable when the application chunks are stale.
 * The worker never handles cross-origin requests, never caches itself, and
 * only activates a waiting update after the page asks it to do so.
 *
 * Offline model (verified behavior, not a promise):
 *   - `install` caches the shell document and the entry graph it references
 *     (module scripts, styles, fonts, the manifest) plus the WASM binaries.
 *     This is what makes offline-after-setup real; a stale chunk outside the
 *     entry graph is still recovered through the page's stale-asset banner.
 *   - navigations are network-first, then the cached shell, then a truthful
 *     503 offline page. The 503 page exists because "offline with a partial
 *     cache" is a real state — pretending the app loaded would be worse.
 *   - hashed asset requests are cache-first within the bounded cache.
 *   - caches are versioned; `activate` removes only this app's older caches.
 */

const CACHE_NAME = 'varve-demo-shell-v2';
const MAX_CACHE_ENTRIES = 256;
const MAX_ENTRY_REFS = 64;

/**
 * Whether the last navigation this worker answered came from the network.
 * `navigator.onLine` is not authoritative (captive portals, emulated offline
 * conditions), so the page asks the worker what actually happened when it
 * needs to label the current session as "served from the browser cache".
 */
let lastNavigationOnline = true;
const PRECACHE_ASSETS = [
  './wasm/varve_wasm.js',
  './wasm/varve_wasm_simd.js',
  './wasm/varve_wasm_bg.wasm',
  './wasm/varve_wasm_simd_bg.wasm',
  './wasm/varve_colour.js',
  './wasm/varve_colour_bg.wasm',
];

/*
 * Truthful unavailable page. Deliberately has no external references and no
 * inline script, so it renders even when nothing else is cached. The style is
 * self-contained for the same reason. Content matches the boot fallback's
 * brand-fixed dark palette; theme tokens may not be cached yet.
 */
const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Varve — offline</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    background: #10151f;
    color: #fff;
    font: 16px/1.5 system-ui, -apple-system, sans-serif;
  }
  main { max-width: 34rem; padding: 2rem; text-align: left; }
  h1 { font-size: 1.35rem; margin: 0 0 0.75rem; }
  p { margin: 0 0 1rem; color: rgb(255 255 255 / 0.78); }
  a {
    display: inline-block;
    padding: 0.55rem 1.1rem;
    border-radius: 6px;
    background: #39d0c6;
    color: #10151f;
    font-weight: 600;
    text-decoration: none;
  }
</style>
</head>
<body>
<main>
  <h1>Varve is not available offline yet</h1>
  <p>
    This browser has not finished saving the demo for offline use, so there is
    no cached copy to open. Reconnect to the network and reload to finish
    setup; after one complete online visit the demo can open offline.
  </p>
  <p>
    Your saved documents live in this browser's storage and are not affected
    by this page. Nothing was deleted.
  </p>
  <a href="./">Reload</a>
</main>
</body>
</html>`;

function isCacheableRequest(request) {
  const url = new URL(request.url);
  return (
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    request.url !== self.location.href
  );
}

function isCacheableAsset(request) {
  const url = new URL(request.url);
  return (
    ['script', 'style', 'font', 'image', 'worker', 'manifest'].includes(request.destination) ||
    url.pathname.endsWith('.wasm')
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

/**
 * Collect same-origin, in-scope references from the shell HTML.
 *
 * The entry graph is what makes an offline reload possible: the shell
 * document alone references hashed module scripts, stylesheet links, font
 * files, modulepreload links, and the web manifest. Every one of them must be
 * in the cache before the network disappears. The list is bounded; pages that
 * reference more than that are not the demo shell, and caching everything
 * would compete with the document's own storage budget.
 */
function collectEntryRefs(html, baseHref) {
  const scope = new URL(self.registration.scope);
  const refs = new Set();
  const pattern = /(?:src|href)="([^"]+)"/g;
  let match = pattern.exec(html);
  while (match && refs.size < MAX_ENTRY_REFS) {
    try {
      const url = new URL(match[1], baseHref);
      if (
        url.origin === self.location.origin &&
        url.pathname.startsWith(scope.pathname) &&
        (url.protocol === 'https:' || url.protocol === 'http:')
      ) {
        refs.add(url.href);
      }
    } catch {
      // Malformed or non-URL references are not worth failing install over.
    }
    match = pattern.exec(html);
  }
  return [...refs];
}

/** Cache one URL, ignoring failure so one missing optional asset cannot break install. */
async function addBestEffort(cache, url) {
  try {
    await cache.add(url);
  } catch {
    // Optional entry-graph members (for example per-DPR fonts) do not block
    // the shell from installing.
  }
}

async function precacheShell(cache) {
  const shellHref = new URL('./', self.registration.scope).href;
  // A failed shell fetch must not reject install: offline-first is best
  // effort until the shell has been loaded once. A later request retries.
  await addBestEffort(cache, shellHref);
  const shell = await cache.match(shellHref);
  if (shell) {
    try {
      const html = await shell.text();
      const refs = collectEntryRefs(html, shellHref);
      for (const ref of refs) {
        await addBestEffort(cache, ref);
      }
    } catch {
      // A non-text or empty shell still leaves the fallback offline page.
    }
  }
  for (const asset of PRECACHE_ASSETS) {
    await addBestEffort(cache, new URL(asset, self.registration.scope).href);
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await cacheResponse(request, await fetch(request));
    lastNavigationOnline = true;
    return response;
  } catch {
    lastNavigationOnline = false;
    const shellHref = new URL('./', self.registration.scope).href;
    const cached = (await cache.match(request)) || (await cache.match(shellHref));
    if (cached) return cached;
    return new Response(OFFLINE_FALLBACK_HTML, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
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
      await precacheShell(cache);
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
    return;
  }
  // Connectivity report for the page: "was the document you are running in
  // served from cache?" The page cannot trust navigator.onLine, but the
  // worker knows exactly which branch its navigation fetch took.
  if (event.data?.type === 'VARVE_DEMO_CONNECTIVITY_PING') {
    const port = event.ports?.[0];
    port?.postMessage({
      type: 'VARVE_DEMO_CONNECTIVITY_PONG',
      online: lastNavigationOnline,
    });
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

  if (isCacheableAsset(request)) {
    event.respondWith(cacheFirst(request));
  }
});
