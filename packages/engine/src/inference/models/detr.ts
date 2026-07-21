/**
 * DETR (DEtection TRansformer) — open-vocabulary-adjacent object
 * detection over the 80 COCO classes. Enables "detect subjects" for
 * Crop/Subject-aware resize and a standalone object-detection workflow.
 *
 * Model: facebook/detr-resnet-50 (Apache-2.0). ONNX export:
 * Xenova/detr-resnet-50 (Transformers.js-compatible rehost, same
 * license). Verified 2026-07-21 by downloading the real graph and
 * running inference directly:
 *   inputs: pixel_values [B,3,H,W] float32, pixel_mask [B,64,64] int64
 *     (all-ones = no padding; empirically confirmed to work for both
 *     800x800 and 640x640 real inference calls)
 *   outputs: logits [B,100,92] (91 COCO label ids + 1 "no object" class
 *     at the last index, per the standard HF DetrForObjectDetection
 *     convention), pred_boxes [B,100,4] (center_x, center_y, w, h, all
 *     normalized 0-1 relative to the *input* image, i.e. the letterboxed
 *     800x800 square — must be mapped back through the letterbox
 *     transform to get real image coordinates, same class of bug as
 *     SAM2's prompt coordinates).
 * Opset 12, no custom ops.
 */
import type { TensorSpec } from '../imageTensor';

export const DETR_INPUT_SIZE = 800;
const NUM_QUERIES = 100;
const NUM_CLASSES_WITH_NO_OBJECT = 92;
const NO_OBJECT_INDEX = 91;

export const DETR_TENSOR_SPEC: TensorSpec = {
  inputWidth: DETR_INPUT_SIZE,
  inputHeight: DETR_INPUT_SIZE,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [0, 0, 0],
};

/**
 * COCO 2017 detection classes, index-aligned to DETR's label ids
 * (0-indexed, with 'N/A' placeholders for unused ids — DETR keeps the
 * original 90-class COCO label space including gaps, standard
 * torchvision/HF convention). Index 91 is not in this list — it's the
 * synthetic "no object" class filtered out during decoding, not a real
 * category.
 */
export const COCO_CLASSES: readonly string[] = [
  'N/A',
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'airplane',
  'bus',
  'train',
  'truck',
  'boat',
  'traffic light',
  'fire hydrant',
  'N/A',
  'stop sign',
  'parking meter',
  'bench',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep',
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  'N/A',
  'backpack',
  'umbrella',
  'N/A',
  'N/A',
  'handbag',
  'tie',
  'suitcase',
  'frisbee',
  'skis',
  'snowboard',
  'sports ball',
  'kite',
  'baseball bat',
  'baseball glove',
  'skateboard',
  'surfboard',
  'tennis racket',
  'bottle',
  'N/A',
  'wine glass',
  'cup',
  'fork',
  'knife',
  'spoon',
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'chair',
  'couch',
  'potted plant',
  'bed',
  'N/A',
  'dining table',
  'N/A',
  'N/A',
  'toilet',
  'N/A',
  'tv',
  'laptop',
  'mouse',
  'remote',
  'keyboard',
  'cell phone',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'refrigerator',
  'N/A',
  'book',
  'clock',
  'vase',
  'scissors',
  'teddy bear',
  'hair drier',
  'toothbrush',
];

export interface DetrDetection {
  label: string;
  classId: number;
  confidence: number;
  /** Bounding box in the original image's pixel space (letterbox undone). */
  box: { x: number; y: number; width: number; height: number };
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Decode DETR's raw logits + normalized boxes into filtered detections
 * in original-image pixel coordinates. `letterbox` must be the transform
 * the image actually went through during preprocessing (from
 * WorkerInferResult.outputs.letterbox) — omitting it for a non-square
 * source image reproduces the SAM2 coordinate bug.
 */
export function decodeDetrOutput(
  logitsData: Float32Array,
  boxesData: Float32Array,
  originalWidth: number,
  originalHeight: number,
  letterbox: { offsetX: number; offsetY: number } = { offsetX: 0, offsetY: 0 },
  confidenceThreshold = 0.7,
): DetrDetection[] {
  const results: DetrDetection[] = [];
  const scaledW = DETR_INPUT_SIZE - 2 * letterbox.offsetX;
  const scaledH = DETR_INPUT_SIZE - 2 * letterbox.offsetY;

  for (let q = 0; q < NUM_QUERIES; q++) {
    const logits: number[] = [];
    for (let c = 0; c < NUM_CLASSES_WITH_NO_OBJECT; c++) {
      logits.push(logitsData[q * NUM_CLASSES_WITH_NO_OBJECT + c]!);
    }
    const probs = softmax(logits);

    let bestClass = 0;
    let bestProb = -Infinity;
    for (let c = 0; c < NO_OBJECT_INDEX; c++) {
      if (probs[c]! > bestProb) {
        bestProb = probs[c]!;
        bestClass = c;
      }
    }
    if (bestProb < confidenceThreshold) continue;
    if (COCO_CLASSES[bestClass] === 'N/A') continue;

    // Box in normalized [0,1] cx,cy,w,h relative to the 800x800
    // letterboxed input — map through the letterbox transform to get
    // pixel coordinates in the *padded* space, then subtract the offset
    // and undo the scale to land in the original image's pixel space.
    const cx = boxesData[q * 4]! * DETR_INPUT_SIZE;
    const cy = boxesData[q * 4 + 1]! * DETR_INPUT_SIZE;
    const bw = boxesData[q * 4 + 2]! * DETR_INPUT_SIZE;
    const bh = boxesData[q * 4 + 3]! * DETR_INPUT_SIZE;

    const scaleX = originalWidth / scaledW;
    const scaleY = originalHeight / scaledH;

    const x = (cx - bw / 2 - letterbox.offsetX) * scaleX;
    const y = (cy - bh / 2 - letterbox.offsetY) * scaleY;
    const width = bw * scaleX;
    const height = bh * scaleY;

    results.push({
      label: COCO_CLASSES[bestClass]!,
      classId: bestClass,
      confidence: bestProb,
      box: {
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.min(width, originalWidth),
        height: Math.min(height, originalHeight),
      },
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
