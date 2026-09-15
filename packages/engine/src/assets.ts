/**
 * Runtime asset URL resolution.
 *
 * The web build can be served from a non-root base path (e.g. the public
 * "try in browser" demo at /try/). Assets that live in the Vite `public/`
 * directory are copied verbatim (never hashed), so anything fetched at
 * runtime — WASM binaries, ONNX Runtime companions, models — must resolve
 * against the configured asset base instead of a hardcoded root path.
 *
 * `__VARVE_ASSET_BASE__` is a build-time define set by the app's Vite config
 * (from `VITE_BASE_URL`); it defaults to '/' when absent (unit tests, apps
 * without the define).
 */

declare const __VARVE_ASSET_BASE__: string | undefined;

function configuredAssetBase(): string {
  if (typeof __VARVE_ASSET_BASE__ !== 'undefined' && __VARVE_ASSET_BASE__) {
    return __VARVE_ASSET_BASE__;
  }
  return '/';
}

/** Resolve a public-dir-relative path (leading slash optional) to an absolute
 *  URL against the configured asset base. Never falls back to a bare root
 *  path when the base is a sub-path. */
export function resolveAppAssetUrl(relativePath: string, locationHref?: string): string {
  const href =
    locationHref ??
    (typeof globalThis.location !== 'undefined' ? globalThis.location.href : 'http://localhost/');
  const origin = new URL(href).origin;
  const baseUrl = new URL(configuredAssetBase(), `${origin}/`);
  return new URL(relativePath.replace(/^\//, ''), baseUrl).href;
}
