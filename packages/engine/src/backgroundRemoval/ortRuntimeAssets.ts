/** Resolve and configure ONNX Runtime Web companion assets consistently. */

import { resolveAppAssetUrl } from '../assets';

export { resolveAppAssetUrl } from '../assets';

export const REQUIRED_ORT_RUNTIME_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
] as const;

let loggedConfiguration = false;

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
