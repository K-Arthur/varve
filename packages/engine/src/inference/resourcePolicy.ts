import { estimateInferenceReservation } from './admission';
import type { RuntimeCapabilities } from './core/types';

/**
 * A source ImageData is copied at least once before it reaches ONNX Runtime.
 * Four bytes per pixel is the canonical RGBA frame size; the admission
 * multiplier accounts for the canvas, ImageData, and runtime conversion
 * buffers that can coexist during an encoder call.
 */
const IMAGE_WORKING_SET_MULTIPLIER = 4;

export interface ImageInferenceResourceAssessment {
  allowed: boolean;
  estimatedPeakBytes: number;
  safePeakBytes: number;
  reason?: string;
  reasonCode?: 'insufficient-memory';
}

function formatMiB(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}

/**
 * Check a full-resolution image inference before allocating a canvas or
 * ImageData. This is intentionally separate from the model-only
 * `isWasmModelSafe` check: a model can fit by itself while the source frame
 * pushes a Chromebook/WebView over its safe peak.
 */
export function assessImageInferenceResources(options: {
  width: number;
  height: number;
  modelPeakBytes: number;
  runtime: Pick<RuntimeCapabilities, 'wasmSafePeakBytes'>;
  operation?: string;
}): ImageInferenceResourceAssessment {
  const estimatedPeakBytes = estimateInferenceReservation({
    width: options.width,
    height: options.height,
    modelBytes: options.modelPeakBytes,
    workingSetMultiplier: IMAGE_WORKING_SET_MULTIPLIER,
  });
  const safePeakBytes = options.runtime.wasmSafePeakBytes;

  if (safePeakBytes <= 0 || estimatedPeakBytes <= safePeakBytes) {
    return { allowed: true, estimatedPeakBytes, safePeakBytes };
  }

  const operation = options.operation ?? 'This image operation';
  return {
    allowed: false,
    estimatedPeakBytes,
    safePeakBytes,
    reasonCode: 'insufficient-memory',
    reason:
      `${operation} needs about ${formatMiB(estimatedPeakBytes)}, but this runtime's ` +
      `safe inference budget is ${formatMiB(safePeakBytes)}. ` +
      'Use the brush or Fast cutout path, or work on a smaller image.',
  };
}
