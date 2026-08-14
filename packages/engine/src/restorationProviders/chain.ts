/**
 * Shared restoration provider chain — native first, worker fallback,
 * with the first successful provider pinned for the remaining tiles
 * (mirrors the background-removal chain convention).
 */

import { nativeRestorationProvider } from './nativeProvider';
import type {
  RestorationTileProvider,
  RestorationTileRequest,
  RestorationTileResult,
} from './types';
import { workerRestorationProvider } from './workerProvider';

export const RESTORATION_PROVIDER_CHAIN: RestorationTileProvider[] = [
  nativeRestorationProvider,
  workerRestorationProvider,
];

export function candidateProviders(modelId: string): RestorationTileProvider[] {
  const available = RESTORATION_PROVIDER_CHAIN.filter((provider) => provider.isAvailable(modelId));
  return available.length > 0 ? available : [workerRestorationProvider];
}

/**
 * Run one tile against the provider chain, falling back on failure.
 *
 * `isAvailable` is a capability check, not proof the backend can serve the
 * request: the native provider reports ready whenever it runs under Tauri,
 * yet fails if the model was only ever downloaded for the WASM path (they
 * use separate stores). A failed provider yields to the next one. The
 * first provider that succeeds is pinned for the remaining tiles so a dead
 * provider is not retried once per tile.
 */
export async function restoreTileWithFallback(
  request: RestorationTileRequest,
  candidates: RestorationTileProvider[],
  pinned: { provider: RestorationTileProvider | null },
  signal?: AbortSignal,
): Promise<RestorationTileResult> {
  const chain = pinned.provider ? [pinned.provider] : candidates;
  const errors: string[] = [];
  for (const provider of chain) {
    if (signal?.aborted) throw new Error('cancelled');
    try {
      const result = await provider.restore(request, signal);
      pinned.provider = provider;
      return result;
    } catch (error) {
      if (signal?.aborted) throw new Error('cancelled');
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled') throw new Error('cancelled');
      errors.push(`${provider.id}: ${message}`);
    }
  }
  throw new Error(`Restoration failed (${errors.join('; ')})`);
}
