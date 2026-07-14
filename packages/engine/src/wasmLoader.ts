/**
 * WASM module loader with feature detection and stub fallback.
 */
import type { Engine } from './engine';
import { hitTest as stubHitTest } from './geometry';
import type { RenderItem, SceneNode } from './types';

export interface WasmEngineModule {
  build_ir_json(nodesJson: string): string;
  hit_test_json(nodesJson: string, x: number, y: number): number;
  wasm_engine_version(): string;
}

let cachedModule: WasmEngineModule | null = null;
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

export async function loadWasmEngineModule(): Promise<WasmEngineModule | null> {
  if (cachedModule) return cachedModule;
  try {
    const base = '/wasm';
    const candidates = [`${base}/strata_wasm_simd_bg.wasm`, `${base}/strata_wasm_bg.wasm`];
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
        cachedModule = mod;
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

export function createWasmEngineFromModule(mod: WasmEngineModule): Engine {
  return {
    backend: 'wasm',
    async buildIr(scene) {
      const json = mod.build_ir_json(JSON.stringify(scene.nodes));
      return JSON.parse(json) as RenderItem[];
    },
    async hitTest(scene, world) {
      const idx = mod.hit_test_json(JSON.stringify(scene.nodes), world[0], world[1]);
      return idx >= 0 ? idx : null;
    },
  };
}

/** Test helper: wasm engine with stub fallback on load failure. */
export async function tryWasmEngine(stubEngine: () => Engine): Promise<Engine> {
  const mod = await loadWasmEngineModule();
  if (!mod) return stubEngine();
  return createWasmEngineFromModule(mod);
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
  ): string;
  wasm_trace_version(): string;
}

let cachedTraceModule: WasmTraceModule | null = null;

export async function tryLoadTraceWasm(): Promise<WasmTraceModule | null> {
  if (cachedTraceModule) return cachedTraceModule;
  try {
    const base = '/wasm';
    const candidates = [`${base}/strata_wasm_simd_bg.wasm`, `${base}/strata_wasm_bg.wasm`];
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
