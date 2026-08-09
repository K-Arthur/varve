/**
 * WASM decoder provider — `varve-media` compiled to wasm32 via the existing
 * `varve-wasm` module (same Rust code as the native provider, so decode
 * output is identical across desktop and web).
 */

import type { MediaFormat } from '../types';
import type { DecodeRange, MediaDecoderProvider } from './types';

interface WasmMediaModule {
  media_probe(bytes: Uint8Array): string;
  media_decode_frames(
    bytes: Uint8Array,
    start: number,
    end: number,
  ): { frames: Array<WasmDecodedFrame> };
}

interface WasmDecodedFrame {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  blend: 'source' | 'over';
  disposal: 'none' | 'background' | 'previous';
  preComposited: boolean;
  rgba: Uint8Array;
}

let wasmPromise: Promise<WasmMediaModule | null> | null = null;

/**
 * Load the shared varve-wasm module and reuse its media bindings. The load
 * path mirrors `wasmLoader.ts` (fetch glue from /wasm, import via blob URL,
 * instantiate against the fetched wasm).
 */
export function loadMediaWasmModule(): Promise<WasmMediaModule | null> {
  if (!wasmPromise) {
    wasmPromise = loadMediaWasmModuleUncached().then((mod) => {
      if (!mod) wasmPromise = null;
      return mod;
    });
  }
  return wasmPromise;
}

async function loadMediaWasmModuleUncached(): Promise<WasmMediaModule | null> {
  try {
    const base = '/wasm';
    const candidates = [`${base}/varve_wasm_simd_bg.wasm`, `${base}/varve_wasm_bg.wasm`];
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
          media_probe: (bytes: Uint8Array) => string;
          media_decode_frames: (
            bytes: Uint8Array,
            start: number,
            end: number,
          ) => { frames: Array<WasmDecodedFrame> };
        };
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

export const wasmMediaProvider: MediaDecoderProvider = {
  id: 'wasm-media',
  supports() {
    return true; // gif + apng + webp all compiled in
  },
  isAvailable(_format, signal) {
    if (signal?.aborted) return false;
    return loadMediaWasmModule().then((mod) => mod !== null);
  },
  async decodeFrames(bytes, range: DecodeRange, _format: MediaFormat, signal) {
    const mod = await loadMediaWasmModule();
    if (!mod) throw new Error('WASM media decoder unavailable');
    if (signal?.aborted) throw new Error('cancelled');
    const result = mod.media_decode_frames(bytes, range.start, range.end);
    if (signal?.aborted) throw new Error('cancelled');
    return result.frames.map((f) => ({
      index: f.index,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      durationMs: f.durationMs,
      blend: f.blend,
      disposal: f.disposal,
      preComposited: f.preComposited,
      rgba: f.rgba instanceof Uint8Array ? f.rgba : new Uint8Array(f.rgba),
    }));
  },
};
