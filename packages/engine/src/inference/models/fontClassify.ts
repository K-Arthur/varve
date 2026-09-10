/**
 * Font classification model — EfficientNet B3 finetuned on Google Fonts.
 *
 * SOURCE: storia/font-classify-onnx (HuggingFace, MIT license)
 *   https://huggingface.co/storia/font-classify-onnx
 *
 * Architecture: EfficientNet B3 (timm/efficientnet_b3.ra2_in1k finetuned)
 *   Input:  300x300 RGB, ImageNet normalization
 *   Output: 3473-class logits (Google Fonts families with weight/style variants)
 *
 * License: MIT (code and model weights). Commercial use permitted.
 */

import type { TensorSpec } from '../imageTensor';

export const FONT_CLASSIFY_INPUT_SIZE = 300;

export const FONT_CLASSIFY_TENSOR_SPEC: TensorSpec = {
  inputWidth: FONT_CLASSIFY_INPUT_SIZE,
  inputHeight: FONT_CLASSIFY_INPUT_SIZE,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [255, 255, 255],
};

export const FONT_CLASSIFY_NUM_CLASSES = 3473;

/**
 * Post-process raw logits into ranked font candidates.
 */
export function decodeFontClassifyOutput(
  logits: Float32Array,
  topK = 5,
): Array<{ classIndex: number; confidence: number }> {
  if (logits.length === 0) return [];

  let maxLogit = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i]! > maxLogit) maxLogit = logits[i]!;
  }

  const expScores = new Float32Array(logits.length);
  let sumExp = 0;
  for (let i = 0; i < logits.length; i++) {
    const exp = Math.exp(logits[i]! - maxLogit);
    expScores[i] = exp;
    sumExp += exp;
  }

  const probs = new Float32Array(logits.length);
  for (let i = 0; i < expScores.length; i++) {
    probs[i] = expScores[i]! / sumExp;
  }

  const k = Math.min(topK, probs.length);
  const indexed = new Array(probs.length);
  for (let i = 0; i < probs.length; i++) {
    indexed[i] = { classIndex: i, confidence: probs[i]! };
  }
  indexed.sort((a, b) => b.confidence - a.confidence);

  const top: Array<{ classIndex: number; confidence: number }> = [];
  for (let i = 0; i < k; i++) {
    const item = indexed[i];
    if (item) {
      top.push(item);
    }
  }

  return top;
}
