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

export async function loadWasmEngineModule(): Promise<WasmEngineModule | null> {
  if (cachedModule) return cachedModule;
  try {
    const base = '/wasm';
    const candidates = [`${base}/strata_wasm_bg.wasm`, `${base}/strata_wasm_simd_bg.wasm`];
    for (const wasmUrl of candidates) {
      try {
        const response = await fetch(wasmUrl, { method: 'HEAD' });
        if (!response.ok) continue;
        const jsUrl = wasmUrl.replace('_bg.wasm', '.js').replace('_simd_bg.wasm', '_simd.js');
        const mod = (await import(/* @vite-ignore */ jsUrl)) as {
          default: (input?: WebAssembly.Module | BufferSource) => Promise<void>;
          build_ir_json: (json: string) => string;
          hit_test_json: (json: string, x: number, y: number) => number;
          wasm_engine_version: () => string;
        };
        await mod.default(fetch(wasmUrl).then((r) => r.arrayBuffer()));
        cachedModule = mod;
        return mod;
      } catch {}
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
