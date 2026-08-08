/**
 * Live-effect dispatch — accelerated backends for the live-effects family.
 *
 * The interactive adjustment path stays synchronous CPU (CanvasArea's
 * per-frame render loop); this module is the async dispatch used by the
 * export pipeline, where throughput at export quality matters and a
 * single-shot async round-trip costs nothing:
 *
 *   nativeEffectProvider  — Tauri IPC → crates/varve-effects (desktop, first)
 *   gpuEffectProvider     — WebGPU compute (@varve/compositor, web, second)
 *   cpuEffectProvider     — the existing TS kernels (byte-level reference)
 *
 * Provider order follows the trace system's dispatch: native-first under
 * Tauri, GPU before CPU on web, CPU always as the final fallback. A missing
 * backend can never destroy content — every path converges on the CPU
 * kernels.
 *
 * The wire request shape mirrors the Rust `EffectRequest` contract
 * (`crates/varve-effects/src/lib.rs`, camelCase field names — snake_case
 * keys are silently ignored by the native command).
 */

import { isTauriRuntime as isTauri } from '@varve/platform';
import { applyBloom } from './bloom';
import { applyCaustics } from './caustics';
import { applyCrt } from './crt';
import type { CoordSpace } from './dither';
import { applyDither } from './dither';
import { applyLensFlare } from './lensFlare';
import { applyLightLeak } from './lightLeak';
import { applyLightShafts } from './lightShafts';
import { applyPaletteSnap } from './paletteSnap';
import type { EffectQuality } from './quality';
import { applyRgbSplit } from './rgbSplit';
import { applyVhs } from './vhs';

export type LiveEffectKind =
  | 'dither'
  | 'paletteSnap'
  | 'bloom'
  | 'rgbSplit'
  | 'crt'
  | 'vhs'
  | 'lightShafts'
  | 'lensFlare'
  | 'lightLeak'
  | 'caustics';

export interface EffectDispatchRequest {
  effect: LiveEffectKind;
  width: number;
  height: number;
  /** Caller render tier ('auto' params resolve against it, as in the kernels). */
  quality: EffectQuality;
  coordSpace?: CoordSpace;
  params: Record<string, unknown>;
}

export interface LiveEffectProvider {
  readonly id: string;
  readonly label: string;
  isAvailable(): Promise<boolean>;
  apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray>;
}

function arrayBufferForBytes(bytes: Uint8ClampedArray | Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer as ArrayBuffer;
  if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
    return buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function responseBytes(value: ArrayBuffer | number[]): Uint8ClampedArray {
  if (value instanceof ArrayBuffer) return new Uint8ClampedArray(value);
  return new Uint8ClampedArray(value);
}

/**
 * Desktop-first provider: Tauri `apply_live_effect_binary` — raw RGBA body +
 * `x-varve-effect` JSON header, raw RGBA response. Bounded on the Rust side
 * (pixel-count ceiling) and runs on a blocking thread.
 */
export const nativeEffectProvider: LiveEffectProvider = {
  id: 'native-effects',
  label: 'Native (Desktop)',
  isAvailable() {
    return Promise.resolve(isTauri());
  },
  async apply(request, rgba) {
    if (!isTauri()) throw new Error('Native effects require the desktop app');
    const [{ invoke }] = await Promise.all([import('@tauri-apps/api/core')]);
    const wireOptions = {
      effect: request.effect,
      width: request.width,
      height: request.height,
      quality: request.quality,
      coordSpace: request.coordSpace ?? undefined,
      params: request.params,
    };
    const resultBytes = await invoke<ArrayBuffer | number[]>(
      'apply_live_effect_binary',
      arrayBufferForBytes(rgba),
      {
        headers: { 'x-varve-effect': JSON.stringify(wireOptions) },
      },
    );
    const result = responseBytes(resultBytes);
    if (result.length !== rgba.length) {
      throw new Error(`Native effect returned ${result.length} bytes, expected ${rgba.length}`);
    }
    return result;
  },
};

/**
 * Reference provider: the existing TS kernels, byte-identical to the
 * interactive preview path. Always available.
 */
export const cpuEffectProvider: LiveEffectProvider = {
  id: 'cpu-effects',
  label: 'CPU (TypeScript)',
  isAvailable() {
    return Promise.resolve(true);
  },
  async apply(request, rgba) {
    const imageData = new ImageData(new Uint8ClampedArray(rgba), request.width, request.height);
    const options = {
      quality: request.quality,
      coordSpace: request.coordSpace,
    };
    switch (request.effect) {
      case 'dither':
        applyDither(
          imageData,
          request.params as unknown as Parameters<typeof applyDither>[1],
          options.coordSpace,
        );
        break;
      case 'paletteSnap':
        applyPaletteSnap(
          imageData,
          request.params as unknown as Parameters<typeof applyPaletteSnap>[1],
        );
        break;
      case 'bloom':
        applyBloom(
          imageData,
          request.params as unknown as Parameters<typeof applyBloom>[1],
          options,
        );
        break;
      case 'rgbSplit':
        applyRgbSplit(
          imageData,
          request.params as unknown as Parameters<typeof applyRgbSplit>[1],
          options.coordSpace,
        );
        break;
      case 'crt':
        applyCrt(imageData, request.params as unknown as Parameters<typeof applyCrt>[1]);
        break;
      case 'vhs':
        applyVhs(imageData, request.params as unknown as Parameters<typeof applyVhs>[1], options);
        break;
      case 'lightShafts':
        applyLightShafts(
          imageData,
          request.params as unknown as Parameters<typeof applyLightShafts>[1],
          options,
        );
        break;
      case 'lensFlare':
        applyLensFlare(
          imageData,
          request.params as unknown as Parameters<typeof applyLensFlare>[1],
          options,
        );
        break;
      case 'lightLeak':
        applyLightLeak(
          imageData,
          request.params as unknown as Parameters<typeof applyLightLeak>[1],
        );
        break;
      case 'caustics':
        applyCaustics(
          imageData,
          request.params as unknown as Parameters<typeof applyCaustics>[1],
          options,
        );
        break;
    }
    return new Uint8ClampedArray(imageData.data);
  },
};

/**
 * Build the dispatch chain for a platform. The GPU provider lives in
 * `@varve/compositor` (it cannot live here: compositor already imports from
 * engine, so a reverse import would form a cycle); pass it in from the
 * consumer. A missing GPU provider simply drops the GPU tier.
 */
export function buildEffectChain(gpu?: LiveEffectProvider): LiveEffectProvider[] {
  const chain: LiveEffectProvider[] = [];
  if (isTauri()) chain.push(nativeEffectProvider);
  if (gpu) chain.push(gpu);
  chain.push(cpuEffectProvider);
  return chain;
}

/**
 * Dispatch one effect through the chain — first available success wins; all
 * failures are recorded and the last error surfaces only when no provider
 * succeeded.
 */
export async function dispatchLiveEffect(
  request: EffectDispatchRequest,
  rgba: Uint8ClampedArray,
  chain: LiveEffectProvider[],
): Promise<Uint8ClampedArray> {
  const errors: string[] = [];
  for (const provider of chain) {
    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      available = false;
    }
    if (!available) continue;
    try {
      const result = await provider.apply(request, rgba);
      if (result.length !== rgba.length) {
        throw new Error(`${provider.id} returned ${result.length} bytes, expected ${rgba.length}`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.id}: ${message}`);
    }
  }
  throw new Error(
    errors.length > 0
      ? `Live effect failed (${errors.join('; ')})`
      : 'No live effect provider available',
  );
}

/** Capability report: which providers would accept a request on this host. */
export async function effectCapabilityReport(
  chain: LiveEffectProvider[],
): Promise<{ available: boolean; providerIds: string[] }> {
  const providerIds: string[] = [];
  for (const provider of chain) {
    let ok = false;
    try {
      ok = await provider.isAvailable();
    } catch {
      ok = false;
    }
    if (ok) providerIds.push(provider.id);
  }
  return { available: providerIds.length > 0, providerIds };
}
