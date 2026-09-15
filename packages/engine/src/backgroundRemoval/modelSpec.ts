import type { WorkerModelId } from './types';

export interface SegmentationModelSpec {
  inputSize: number;
  mean: readonly [number, number, number];
  std: readonly [number, number, number];
  applySigmoid: boolean;
  paddingRgb: readonly [number, number, number];
}

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

/**
 * The quantized variant is a 320x320 u2netp-family graph with the same
 * probability output, not a 1024 BiRefNet-style graph. Keeping this mapping
 * explicit prevents the INT8 variant from being packed with ImageNet
 * normalization at 1024 and failing (or silently degrading) at session input.
 */
function isU2NetLightFamily(modelId: WorkerModelId): boolean {
  return modelId === 'u2netp' || modelId === 'u2netp-int8';
}

/** Exact preprocessing/output conventions for the supported rembg models. */
export function getSegmentationModelSpec(modelId: WorkerModelId): SegmentationModelSpec {
  if (modelId === 'modnet-portrait') {
    // MODNet uses the aspect-preserving 512-edge/div-32 preprocessor in
    // modnetPortrait.ts, not a square letterbox. The worker branches before
    // this function for that model; calling it here is a programming error.
    throw new Error('MODNet portrait preprocessing is handled by the dedicated portrait path');
  }
  if (modelId === 'isnet-general-use') {
    return {
      inputSize: 1024,
      mean: [0.5, 0.5, 0.5],
      std: [1, 1, 1],
      applySigmoid: false,
      paddingRgb: [128, 128, 128],
    };
  }

  const u2netLight = isU2NetLightFamily(modelId);
  return {
    inputSize: u2netLight ? 320 : 1024,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
    applySigmoid: !u2netLight,
    // Mean-colour padding maps close to zero after ImageNet normalization.
    paddingRgb: [124, 116, 104],
  };
}

/** Pack RGBA bytes into the model's NCHW float tensor without image-dependent scaling. */
export function packModelInput(
  imageData: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  spec: SegmentationModelSpec,
): Float32Array {
  const pixelCount = imageData.width * imageData.height;
  const result = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = (imageData.data[i * 4 + channel] ?? 0) / 255;
      result[channel * pixelCount + i] =
        (value - (spec.mean[channel] ?? 0)) / (spec.std[channel] ?? 1);
    }
  }
  return result;
}
