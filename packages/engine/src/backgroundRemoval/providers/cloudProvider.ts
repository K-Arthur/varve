import type { CloudApiResponse, CloudProviderSettings } from '../cloudConfig';
import { loadCloudConfig } from '../cloudConfig';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';
import type { RemovalProvider } from './types';

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s) {
      if (s.aborted) {
        controller.abort();
        return controller.signal;
      }
      s.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return controller.signal;
}

async function removeBackgroundViaCloud(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  config: CloudProviderSettings,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  const start = performance.now();

  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });

  const formData = new FormData();
  formData.append('image', blob, 'image.png');
  formData.append(
    'options',
    JSON.stringify({
      method: options.method,
      feather: options.feather,
      decontaminate: options.decontaminate,
    }),
  );

  let lastError: Error | null = null;
  const maxRetries = config.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('cancelled');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout ?? 30000);

      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: formData,
        signal: combineSignals(signal, controller.signal),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Cloud API returned ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as CloudApiResponse;
      const processingTimeMs = Math.round(performance.now() - start);

      return {
        maskDataUrl: result.maskDataUrl,
        confidence: result.confidence,
        method: options.method,
        processingTimeMs,
        width: imageData.width,
        height: imageData.height,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  throw lastError ?? new Error('Cloud inference failed');
}

function getAiFeaturesEnabled(): boolean {
  try {
    const raw = localStorage.getItem('varve-editor-settings');
    if (!raw) return true;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ai = parsed.ai as Record<string, unknown> | undefined;
    return ai?.enabled !== false;
  } catch {
    return true;
  }
}

export const cloudRemovalProvider: RemovalProvider = {
  id: 'cloud',

  isAvailable: async (_options: BackgroundRemovalOptions): Promise<boolean> => {
    // AI gating: Check if AI features are globally enabled before checking cloud config
    if (!getAiFeaturesEnabled()) return false;
    const config = loadCloudConfig();
    if (!config) return false;
    return config.enabled && config.apiUrl.length > 0 && config.apiKey.length > 0;
  },

  async remove(
    imageData: ImageData,
    options: BackgroundRemovalOptions,
    signal?: AbortSignal,
  ): Promise<BackgroundRemovalResult> {
    const config = loadCloudConfig();
    if (!config) {
      throw new Error('Cloud provider is not configured');
    }
    return removeBackgroundViaCloud(imageData, options, config, signal);
  },
};
