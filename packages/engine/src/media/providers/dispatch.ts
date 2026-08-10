/**
 * Provider chain dispatch — runtime-ordered, first-available-wins
 * (mirrors `traceDispatch`). Desktop (Tauri/WebKitGTK) prefers the native
 * IPC provider; Chromium web prefers ImageDecoder; every runtime falls back
 * to WASM, then the pure-TS GIF decoder.
 */

import { isTauriRuntime as isTauri } from '@varve/platform';
import { imageDecoderProvider } from './imageDecoderProvider';
import { nativeMediaProvider } from './nativeProvider';
import { tsGifMediaProvider } from './tsGifProvider';
import type { MediaDecoderProvider } from './types';
import { wasmMediaProvider } from './wasmProvider';

export { imageDecoderProvider } from './imageDecoderProvider';
export { nativeMediaProvider } from './nativeProvider';
export { tsGifMediaProvider } from './tsGifProvider';
export type { DecodeRange, MediaDecoderProvider } from './types';
export { loadMediaWasmModule, wasmMediaProvider } from './wasmProvider';

/** Runtime-ordered provider chain. */
export function mediaProviderChain(): MediaDecoderProvider[] {
  return isTauri()
    ? [nativeMediaProvider, imageDecoderProvider, wasmMediaProvider, tsGifMediaProvider]
    : [imageDecoderProvider, wasmMediaProvider, tsGifMediaProvider];
}

/**
 * Decode source frames through the chain: the first provider that supports
 * the format and reports availability wins; failures fall through. Throws
 * with a combined message when every provider fails.
 */
export async function dispatchDecode(
  chain: MediaDecoderProvider[],
  bytes: Uint8Array,
  range: { start: number; end: number },
  format: import('../types').MediaFormat,
  signal?: AbortSignal,
): Promise<import('../types').DecodedSourceFrame[]> {
  if (signal?.aborted) throw new Error('cancelled');
  const errors: string[] = [];
  for (const provider of chain) {
    if (signal?.aborted) throw new Error('cancelled');
    if (!provider.supports(format)) continue;
    let available: boolean;
    try {
      available = await provider.isAvailable(format, signal);
    } catch {
      available = false;
    }
    if (!available) continue;
    try {
      return await provider.decodeFrames(bytes, range, format, signal);
    } catch (error) {
      if (signal?.aborted) throw new Error('cancelled');
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled' || message === 'stale') throw error;
      errors.push(`${provider.id}: ${message}`);
    }
  }
  throw new Error(
    errors.length > 0
      ? `Media decode failed (${errors.join('; ')})`
      : 'No media decoder provider available',
  );
}
