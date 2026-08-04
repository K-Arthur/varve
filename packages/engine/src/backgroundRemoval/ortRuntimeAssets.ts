/** Resolve and configure ONNX Runtime Web companion assets consistently. */

declare const __VARVE_ASSET_BASE__: string | undefined;

export const REQUIRED_ORT_RUNTIME_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
] as const;

let loggedConfiguration = false;

function configuredAssetBase(): string {
  if (typeof __VARVE_ASSET_BASE__ !== 'undefined' && __VARVE_ASSET_BASE__) {
    return __VARVE_ASSET_BASE__;
  }
  return '/';
}

export function resolveAppAssetUrl(relativePath: string, locationHref?: string): string {
  const href =
    locationHref ??
    (typeof globalThis.location !== 'undefined' ? globalThis.location.href : 'http://localhost/');
  const origin = new URL(href).origin;
  const baseUrl = new URL(configuredAssetBase(), `${origin}/`);
  return new URL(relativePath.replace(/^\//, ''), baseUrl).href;
}

export function getOrtWasmBaseUrl(locationHref?: string): string {
  return resolveAppAssetUrl('ort-wasm/', locationHref);
}

export function configureOrtRuntime(ort: typeof import('onnxruntime-web')): string {
  const wasmBaseUrl = getOrtWasmBaseUrl();
  ort.env.wasm.wasmPaths = wasmBaseUrl;

  if (!loggedConfiguration) {
    loggedConfiguration = true;
    console.info('[bg-removal] ONNX Runtime Web assets configured', {
      version: ort.env.versions.web ?? ort.env.versions.common,
      wasmBaseUrl,
      requiredFiles: REQUIRED_ORT_RUNTIME_FILES,
      crossOriginIsolated:
        typeof globalThis.crossOriginIsolated === 'boolean'
          ? globalThis.crossOriginIsolated
          : false,
      sharedArrayBuffer: typeof globalThis.SharedArrayBuffer !== 'undefined',
      wasmThreads: ort.env.wasm.numThreads,
    });
  }

  return wasmBaseUrl;
}

export function resetOrtRuntimeDiagnostics(): void {
  loggedConfiguration = false;
}
