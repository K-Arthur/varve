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

/** Exact preprocessing/output conventions for the supported rembg models. */
export function getSegmentationModelSpec(modelId: WorkerModelId): SegmentationModelSpec {
  if (modelId === 'isnet-general-use') {
    return {
      inputSize: 1024,
      mean: [0.5, 0.5, 0.5],
      std: [1, 1, 1],
      applySigmoid: false,
      paddingRgb: [128, 128, 128],
    };
  }

  return {
    inputSize: modelId === 'u2netp' ? 320 : 1024,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
    applySigmoid: modelId !== 'u2netp',
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
