import { isTauriRuntime as isTauri } from '@varve/platform';
import type { RasterTraceOptions, RasterTraceResult } from '../rasterTrace';
import { directTraceProvider } from './directTraceProvider';
import { nativeTraceProvider } from './nativeTraceProvider';
import type { TraceProvider } from './types';
import { wasmTraceProvider } from './wasmTraceProvider';
import { workerTraceProvider } from './workerTraceProvider';

export { directTraceProvider } from './directTraceProvider';
export { mapNativePathsToTraceResult } from './mapNativePaths';
export { nativeTraceProvider } from './nativeTraceProvider';
export { wasmTraceProvider } from './wasmTraceProvider';

/**
 * Ordered providers — first available success wins. On desktop, the native
 * engine runs first (it is the production path: full option support,
 * cancellation, progress, and the only centerline implementation). On web
 * the worker/direct TS fallbacks run first.
 */
export const TRACE_PROVIDER_CHAIN: TraceProvider[] = isTauri()
  ? [nativeTraceProvider, workerTraceProvider, directTraceProvider, wasmTraceProvider]
  : [workerTraceProvider, directTraceProvider, wasmTraceProvider];

export async function dispatchTrace(
  imageData: ImageData,
  options: RasterTraceOptions = {},
  signal?: AbortSignal,
  chain: TraceProvider[] = TRACE_PROVIDER_CHAIN,
): Promise<RasterTraceResult> {
  if (signal?.aborted) throw new Error('cancelled');
  const errors: string[] = [];
  for (const provider of chain) {
    if (signal?.aborted) throw new Error('cancelled');
    let available: boolean;
    try {
      available = await provider.isAvailable(options, signal);
    } catch {
      available = false;
    }
    if (!available) continue;
    try {
      return await provider.trace(imageData, options, signal);
    } catch (error) {
      if (signal?.aborted) throw new Error('cancelled');
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled') throw error;
      errors.push(`${provider.id}: ${message}`);
    }
  }
  throw new Error(
    errors.length > 0 ? `Trace failed (${errors.join('; ')})` : 'No trace provider available',
  );
}

/**
 * Capability report for a trace option set: which providers would accept it,
 * and why not. The UI uses this to disable or explain unsupported modes
 * (e.g. centerline on web builds).
 */
export async function traceCapabilityReport(
  options: RasterTraceOptions = {},
): Promise<{ available: boolean; reason?: string; providerIds: string[] }> {
  const providerIds: string[] = [];
  for (const provider of TRACE_PROVIDER_CHAIN) {
    let ok = false;
    try {
      ok = Boolean(await provider.isAvailable(options));
    } catch {
      ok = false;
    }
    if (ok) providerIds.push(provider.id);
  }
  if (providerIds.length > 0) return { available: true, providerIds };
  if (options.traceMode === 'centerline') {
    return {
      available: false,
      reason: 'Centerline tracing requires the desktop app',
      providerIds,
    };
  }
  if (options.mode === 'pixel-art') {
    return {
      available: false,
      reason: 'Pixel-art tracing is unavailable on this platform',
      providerIds,
    };
  }
  return { available: false, reason: 'No trace provider available', providerIds };
}
