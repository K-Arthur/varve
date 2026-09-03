/**
 * WASM module loader with feature detection.
 *
 * This module knows nothing about the `Engine` interface or the render pipeline —
 * it only loads the raw WASM exports (or returns null on failure) and caches the
 * in-flight load so concurrent callers (e.g. an idle-time prewarm racing an
 * explicit engine creation) share one fetch/instantiate attempt instead of two.
 * Shaping a loaded module into an `Engine`, and deciding what to do when loading
 * fails, are the caller's job (see engine.ts's `tryWasmEngine`).
 */
import { resolveAppAssetUrl } from './assets';
import { hitTest as stubHitTest } from './geometry';
import type { SceneNode } from './types';

export interface WasmEngineModule {
  build_ir_json(nodesJson: string): string;
  hit_test_json(nodesJson: string, x: number, y: number): number;
  wasm_engine_version(): string;
}

let wasmModulePromise: Promise<WasmEngineModule | null> | null = null;
let prewarmStarted = false;

/** Warm the WASM engine during idle time so it's ready when first needed. */
export function prewarmWasmEngine(): void {
  if (prewarmStarted) return;
  prewarmStarted = true;
  // Use requestIdleCallback if available, otherwise setTimeout
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      void loadWasmEngineModule();
    });
  } else {
    setTimeout(() => {
      void loadWasmEngineModule();
    }, 500);
  }
}

/**
 * Load (or join an in-flight load of) the WASM engine module. Safe to call
 * concurrently from multiple call sites — everyone awaits the same promise
 * while a load is in flight, so there's exactly one fetch/instantiate attempt
 * running at a time. A successful load is cached forever; a failed one clears
 * the cache so the next call retries (matches prior behavior, which re-fetched
 * on every call after a failure — only the "two callers racing" case changes).
 */
export function loadWasmEngineModule(): Promise<WasmEngineModule | null> {
  if (!wasmModulePromise) {
    wasmModulePromise = loadWasmEngineModuleUncached().then((mod) => {
      if (!mod) wasmModulePromise = null;
      return mod;
    });
  }
  return wasmModulePromise;
}

async function loadWasmEngineModuleUncached(): Promise<WasmEngineModule | null> {
  try {
    const base = resolveAppAssetUrl('wasm/');
    const candidates = [`${base}varve_wasm_simd_bg.wasm`, `${base}varve_wasm_bg.wasm`];
    for (const wasmUrl of candidates) {
      let blobUrl: string | null = null;
      try {
        const response = await fetch(wasmUrl, { method: 'HEAD' });
        if (!response.ok) continue;
        const jsUrl = wasmUrl.replace('_bg.wasm', '.js').replace('_simd_bg.wasm', '_simd.js');
        // Vite's dev server refuses to serve /public assets through its
        // module-transform pipeline — a direct `import(jsUrl)` throws
        // "should not be imported from source code" and blocks the app
        // behind its error overlay. Fetching the glue source and importing
        // it from a blob: URL sidesteps that dev-only restriction (works
        // identically in production, where there's no transform pipeline
        // in the way to begin with).
        const jsSource = await fetch(jsUrl).then((r) => r.text());
        blobUrl = URL.createObjectURL(new Blob([jsSource], { type: 'text/javascript' }));
        const mod = (await import(/* @vite-ignore */ blobUrl)) as {
          default: (opts?: {
            module_or_path?: WebAssembly.Module | BufferSource | Promise<BufferSource>;
          }) => Promise<void>;
          build_ir_json: (json: string) => string;
          hit_test_json: (json: string, x: number, y: number) => number;
          wasm_engine_version: () => string;
        };
        // The generated glue's positional-argument form is deprecated (logs a
        // console warning on every call) in favor of a single options object.
        await mod.default({ module_or_path: fetch(wasmUrl).then((r) => r.arrayBuffer()) });
        return mod;
      } catch {
        // try the next candidate
      } finally {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function wasmHitTestFallback(
  nodes: SceneNode[],
  world: readonly [number, number],
): number | null {
  return stubHitTest(nodes, world);
}

// ── WASM trace module loader ──────────────────────────────────────────

export interface WasmTraceModule {
  trace_contours_json(
    pixels: Uint8Array,
    width: number,
    height: number,
    threshold: number,
    minPixels: number,
    foreground?: string,
  ): string;
  trace_contours_json_opts?(
    pixels: Uint8Array,
    width: number,
    height: number,
    threshold: number,
    minPixels: number,
    foreground: string | undefined,
    optionsJson: string,
  ): string;
  wasm_trace_version(): string;
}

let cachedTraceModule: WasmTraceModule | null = null;

export async function tryLoadTraceWasm(): Promise<WasmTraceModule | null> {
  if (cachedTraceModule) return cachedTraceModule;
  try {
    const base = resolveAppAssetUrl('wasm/');
    const candidates = [`${base}varve_wasm_simd_bg.wasm`, `${base}varve_wasm_bg.wasm`];
    for (const wasmUrl of candidates) {
      let blobUrl: string | null = null;
      try {
        const response = await fetch(wasmUrl, { method: 'HEAD' });
        if (!response.ok) continue;
        const jsUrl = wasmUrl.replace('_bg.wasm', '.js').replace('_simd_bg.wasm', '_simd.js');
        const jsSource = await fetch(jsUrl).then((r) => r.text());
        blobUrl = URL.createObjectURL(new Blob([jsSource], { type: 'text/javascript' }));
        const mod = (await import(/* @vite-ignore */ blobUrl)) as {
          default: (opts?: {
            module_or_path?: WebAssembly.Module | BufferSource | Promise<BufferSource>;
          }) => Promise<void>;
          trace_contours_json: (
            pixels: Uint8Array,
            width: number,
            height: number,
            threshold: number,
            minPixels: number,
          ) => string;
          trace_contours_json_opts?: (
            pixels: Uint8Array,
            width: number,
            height: number,
            threshold: number,
            minPixels: number,
            foreground: string | undefined,
            optionsJson: string,
          ) => string;
          wasm_trace_version: () => string;
        };
        await mod.default({ module_or_path: fetch(wasmUrl).then((r) => r.arrayBuffer()) });
        cachedTraceModule = mod;
        return mod;
      } catch {
        // try the next candidate
      } finally {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }
    }
    return null;
  } catch {
    return null;
  }
}
