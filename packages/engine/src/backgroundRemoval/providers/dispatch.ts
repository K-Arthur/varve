/**
 * Orchestrates background removal via an ordered provider chain (Strategy pattern).
 *
 * Quick mode bypasses AI providers entirely. AI modes try Worker ONNX first
 * (all platforms), then Tauri native IPC, then main-thread ONNX, then heuristic.
 */
import { removeBackgroundHeuristic } from '../heuristic';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';
import { directOnnxRemovalProvider } from './directOnnxProvider';
import { tauriRemovalProvider } from './tauriProvider';
import type { RemovalProvider } from './types';
import { workerRemovalProvider } from './workerProvider';

/** Ordered AI inference providers — first success wins. */
export const AI_PROVIDER_CHAIN: RemovalProvider[] = [
  workerRemovalProvider,
  tauriRemovalProvider,
  directOnnxRemovalProvider,
];

export async function dispatchBackgroundRemoval(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (options.method === 'quick') {
    return removeBackgroundHeuristic(imageData, options);
  }

  for (const provider of AI_PROVIDER_CHAIN) {
    const available = await provider.isAvailable(options);
    if (!available) continue;
    try {
      return await provider.remove(imageData, options, signal);
    } catch {
      // Fall through to the next provider in the chain.
    }
  }

  return removeBackgroundHeuristic(imageData, options);
}
