import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';
import type { RemovalProvider } from './types';

/** Wire-format response from the Rust `remove_background` Tauri command. */
interface TauriBgRemoveResponse {
  maskBase64: string;
  confidence: number;
  method: string;
  processingTimeMs: number;
  width: number;
  height: number;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function invokeTauriRemoveBackground(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
): Promise<BackgroundRemovalResult> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke<TauriBgRemoveResponse>('remove_background', {
    imageData: Array.from(bytes),
    options: {
      method: options.method,
      tolerance: options.tolerance,
      featherRadius: options.feather,
      decontaminate: options.decontaminate ?? true,
      clickX: options.clickPoint?.x,
      clickY: options.clickPoint?.y,
      previewMaxDimension: options.previewMaxDimension,
    },
  });

  // Native only round-trips `'quick'` unless the opt-in `ai` Cargo feature is
  // enabled. Never trust `raw.method` for AI claims (ADR-0005).
  return {
    maskDataUrl: `data:image/png;base64,${raw.maskBase64}`,
    confidence: raw.confidence,
    method: 'quick',
    processingTimeMs: raw.processingTimeMs,
    width: raw.width,
    height: raw.height,
  };
}

export const tauriRemovalProvider: RemovalProvider = {
  id: 'tauri-native',

  isAvailable(_options: BackgroundRemovalOptions): boolean {
    return isTauri();
  },

  remove(imageData, options, _signal) {
    return invokeTauriRemoveBackground(imageData, options);
  },
};
