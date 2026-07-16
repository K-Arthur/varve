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

/** Ordered providers — first available success wins. */
export const TRACE_PROVIDER_CHAIN: TraceProvider[] = [
  workerTraceProvider,
  directTraceProvider,
  wasmTraceProvider,
  nativeTraceProvider,
];

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
