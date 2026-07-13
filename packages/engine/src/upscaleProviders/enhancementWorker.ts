/// <reference lib="webworker" />
/**
 * Enhancement worker: CPU upscale + monochrome trace off the UI thread.
 */

import { type UpscaleOptions, upscaleImageData } from '../imageEnhancement';
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

    if (msg.type === 'upscale') {
      const result =
        (msg.options as UpscaleOptions).method === 'ai'
          ? await upscaleWithRealEsrgan(imageData, msg.modelPath ?? '', () => cancelled.has(msg.id))
          : upscaleImageData(imageData, msg.options);
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
