import type { RasterTraceOptions, RasterTraceResult } from '../rasterTrace';
import { directTraceProvider } from './directTraceProvider';
import type { TraceProvider } from './types';

export { directTraceProvider } from './directTraceProvider';
export { mapNativePathsToTraceResult } from './mapNativePaths';

export async function dispatchTrace(
  imageData: ImageData,
  options: RasterTraceOptions = {},
  signal?: AbortSignal,
  chain?: TraceProvider[],
): Promise<RasterTraceResult> {
  const { workerTraceProvider } = await import('./workerTraceProvider');
  const providers = chain ?? [workerTraceProvider, directTraceProvider];

  if (signal?.aborted) throw new Error('cancelled');
  const errors: string[] = [];
  for (const provider of providers) {
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
