/**
 * Worker-based colorization provider — runs ONNX inference through the
 * shared inference worker (Web Worker with onnxruntime-web).
 *
 * This is the default provider for browser environments and serves as
 * the fallback when native Tauri inference is unavailable.
 */

import { getInferenceWorkerHost } from '../../inference/inferenceWorkerHost';
import type {
  ColorizationRequestContract,
  ColorizationResultContract,
} from '../colorizationRequest';
import type { ColorizationProvider } from '../providerAbstraction';

const WORKER_PROVIDER_ID = 'worker';

async function isWorkerAvailable(): Promise<boolean> {
  try {
    const host = getInferenceWorkerHost();
    return host.isReady || true;
  } catch {
    return false;
  }
}

export const workerColorizationProvider: ColorizationProvider = {
  id: WORKER_PROVIDER_ID,
  name: 'Web Worker (ONNX Runtime Web)',
  estimatedPeakMemory: 512 * 1024 * 1024,

  isAvailable: () => isWorkerAvailable(),

  supportsModel: (modelId: string) => {
    const supported = new Set([
      'scunet',
      'sam2-hiera-tiny',
      'sam2-hiera-tiny-encoder',
      'sam2-hiera-tiny-decoder',
      'ddcolor',
      'lama',
      'lineart',
    ]);
    return supported.has(modelId);
  },

  async run(_request: ColorizationRequestContract): Promise<ColorizationResultContract> {
    throw new Error(
      'Worker provider requires pre-loaded ImageData. ' +
        'Use the pipeline dispatcher which carries image data.',
    );
  },
};
