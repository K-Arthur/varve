/**
 * EfficientNet-Lite4 — lightweight image classification for auto-tagging
 * and content-type detection (photo vs illustration vs document).
 *
 * Model: EfficientNet-Lite4 (MIT — TensorFlow Model Garden origin).
 * ONNX export: onnxmodelzoo/efficientnet-lite4-11 (official ONNX Model
 * Zoo mirror). Verified 2026-07-21 by downloading the real graph and
 * confirming via the model card: NHWC [1,224,224,3] input (not the usual
 * NCHW), preprocessing "(pixel - 127) / 128" giving a [-1,1] range —
 * expressed here as mean=127/255, std=128/255 to fit the shared
 * TensorSpec convention (`(x/255 - mean) / std`). Output: Softmax:0
 * [1,1000] standard ImageNet-1k class probabilities. Opset 11.
 */
import type { TensorSpec } from '../imageTensor';
import { IMAGENET_LABELS } from './imagenetLabels';

export const EFFICIENTNET_INPUT_SIZE = 224;

export const EFFICIENTNET_TENSOR_SPEC: TensorSpec = {
  inputWidth: EFFICIENTNET_INPUT_SIZE,
  inputHeight: EFFICIENTNET_INPUT_SIZE,
  mean: [127 / 255, 127 / 255, 127 / 255],
  std: [128 / 255, 128 / 255, 128 / 255],
  paddingRgb: [127, 127, 127],
};

export interface ClassificationResult {
  label: string;
  classId: number;
  confidence: number;
}

/** Top-K labels from the model's raw softmax output (already normalized —
 * the graph's final op is Softmax, no extra normalization needed here). */
export function decodeEfficientNetOutput(data: Float32Array, topK = 5): ClassificationResult[] {
  const indexed = Array.from(data).map((confidence, classId) => ({ classId, confidence }));
  indexed.sort((a, b) => b.confidence - a.confidence);
  return indexed.slice(0, topK).map(({ classId, confidence }) => ({
    label: IMAGENET_LABELS[classId] ?? `class_${classId}`,
    classId,
    confidence,
  }));
}
