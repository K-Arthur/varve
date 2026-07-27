/// <reference lib="webworker" />
/**
 * Enhancement worker: CPU upscale + monochrome trace off the UI thread.
 */

import { type UpscaleOptions, upscaleImageData, computeUpscalePreview } from '../imageEnhancement';
import { type RasterTraceOptions, traceRasterToPaths } from '../rasterTrace';
import { upscaleWithRealEsrgan } from './aiUpscale';
import type { EnhancementWorkerRequest, EnhancementWorkerResponse } from './enhancementWorkerHost';

const cancelled = new Set<string>();

function post(msg: EnhancementWorkerResponse, transfer?: Transferable[]): void {
  self.postMessage(msg, transfer ?? []);
}

self.onmessage = async (event: MessageEvent<EnhancementWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }

  try {
    if (cancelled.has(msg.id)) {
      cancelled.delete(msg.id);
      post({ type: 'cancelled', id: msg.id });
      return;
    }

    const pixels = new Uint8ClampedArray(msg.buffer);
    const imageData = new ImageData(pixels, msg.width, msg.height);
    const options = msg.options as UpscaleOptions;

    if (msg.type === 'upscale') {
      let result: ImageData;
      if (options.preview) {
        // Preview mode: use CPU preview for non-AI, AI preview handled via downsample
        if (options.method === 'ai') {
          // For AI preview, downsample input to max dimension before inference
          const maxDim = options.previewMaxDimension ?? 512;
          const { width, height } = imageData;
          if (width > maxDim || height > maxDim) {
            const scale = Math.min(maxDim / width, maxDim / height);
            const outW = Math.max(1, Math.round(width * scale));
            const outH = Math.max(1, Math.round(height * scale));
            const downsampled = upscaleImageData(imageData, {
              method: 'bicubic',
              targetWidth: outW,
              targetHeight: outH,
            });
            result = await upscaleWithRealEsrgan(downsampled, msg.modelPath ?? '', () =>
              cancelled.has(msg.id),
            );
          } else {
            result = await upscaleWithRealEsrgan(imageData, msg.modelPath ?? '', () =>
              cancelled.has(msg.id),
            );
          }
        } else {
          // CPU modes: use preview helper
          result = computeUpscalePreview(imageData, options);
        }
      } else {
        // Full upscale
        result =
          options.method === 'ai'
            ? await upscaleWithRealEsrgan(imageData, msg.modelPath ?? '', () =>
                cancelled.has(msg.id),
              )
            : upscaleImageData(imageData, options);
      }
      if (cancelled.has(msg.id)) {
        cancelled.delete(msg.id);
        post({ type: 'cancelled', id: msg.id });
        return;
      }
      const out = new Uint8ClampedArray(result.data);
      post(
        {
          type: 'upscale-result',
          id: msg.id,
          width: result.width,
          height: result.height,
          buffer: out.buffer as ArrayBuffer,
        },
        [out.buffer as ArrayBuffer],
      );
      return;
    }

    const result = traceRasterToPaths(imageData, msg.options as RasterTraceOptions);
    if (cancelled.has(msg.id)) {
      cancelled.delete(msg.id);
      post({ type: 'cancelled', id: msg.id });
      return;
    }
    post({ type: 'trace-result', id: msg.id, result });
  } catch (error) {
    cancelled.delete(msg.id);
    const message = error instanceof Error ? error.message : 'Enhancement worker failed';
    post({ type: 'error', id: msg.id, message });
  }
};
