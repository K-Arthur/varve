/**
 * YuNet face detection (OpenCV face_detection_yunet_2023mar) — a compact,
 * MIT-licensed single-stage face detector with 5 facial keypoints per face.
 * Enables FACE_BOUNDS + FACE_KEYPOINTS for the visual-awareness subsystem
 * (face-aware crop, "Protect Faces", person selection anchors).
 *
 * Model: opencv/face_detection_yunet_2023mar.onnx (MIT). Verified 2026-08-13
 * by downloading the real graph and running inference:
 *   inputs:  input [1,3,640,640] float32, RGB, raw pixel values in [0,255]
 *            (OpenCV feeds blobFromImage with default scale/mean — the graph
 *            bakes its own normalization; do NOT mean/std-normalize here).
 *   outputs: cls_8|16|32 [1,rows*cols,1], obj_8|16|32 [1,rows*cols,1],
 *            bbox_8|16|32 [1,rows*cols,4], kps_8|16|32 [1,rows*cols,10]
 *            at strides 8/16/32 (grid 6400/1600/400 cells, single anchor).
 * Postprocess mirrors OpenCV modules/objdetect/src/face_detect.cpp
 * (FaceDetectorYNImpl::postProcess) bit-for-bit — verified against OpenCV
 * 4.12 FaceDetectorYN on the same graph outputs (max |score| diff 2.2e-9,
 * max |box| diff 1e-5 px).
 *
 * Keypoint order (subject-perspective, per face_detect.cpp):
 *   [right eye, left eye, nose tip, right mouth corner, left mouth corner].
 */
import type { TensorSpec } from '../imageTensor';

export const YU_NET_INPUT_SIZE = 640;
export const YU_NET_STRIDES = [8, 16, 32] as const;

export const YU_NET_TENSOR_SPEC: TensorSpec = {
  inputWidth: YU_NET_INPUT_SIZE,
  inputHeight: YU_NET_INPUT_SIZE,
  // packNchwTensor computes (pixel/255 - mean) / std. To recover the raw
  // [0,255] range the graph expects, use std = 1/255 with mean 0.
  mean: [0, 0, 0],
  std: [1 / 255, 1 / 255, 1 / 255],
  paddingRgb: [0, 0, 0],
};

export type YuNetLandmarkIndex = 0 | 1 | 2 | 3 | 4;

/** Landmark label for each of the 5 keypoint slots (subject perspective). */
export const YU_NET_LANDMARK_NAMES = [
  'RIGHT_EYE',
  'LEFT_EYE',
  'NOSE_TIP',
  'RIGHT_MOUTH_CORNER',
  'LEFT_MOUTH_CORNER',
] as const;

export interface YuNetLandmark {
  x: number;
  y: number;
}

export interface YuNetFaceDetection {
  /** Bounding box in the original image's pixel space (letterbox undone). */
  box: { x: number; y: number; width: number; height: number };
  /** Five keypoints in original-image pixel space. */
  landmarks: readonly YuNetLandmark[];
  score: number;
}

export interface DecodeFaceOptions {
  /** Minimum score = sqrt(clamp(cls)*clamp(obj)) to keep a candidate. */
  scoreThreshold?: number;
  /** IoU above which overlapping faces are suppressed. */
  nmsThreshold?: number;
  /** Cap on detections returned after NMS. */
  topK?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function intersectionOverUnion(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Decode YuNet's raw output tensors into filtered detections in
 * original-image pixel coordinates. `letterbox` must be the transform the
 * image actually went through during preprocessing (from
 * WorkerInferResult.outputs.letterbox) — omitting it for a non-square source
 * reproduces the SAM2/DETR coordinate bug class. Mirrors OpenCV's
 * postProcess() exactly, including greedy NMS over clamp(score).
 */
export function decodeFaceDetections(
  outputs: Record<string, { data: Float32Array; dims: number[] }>,
  originalWidth: number,
  originalHeight: number,
  letterbox: { offsetX: number; offsetY: number } = { offsetX: 0, offsetY: 0 },
  options: DecodeFaceOptions = {},
): YuNetFaceDetection[] {
  const scoreThreshold = options.scoreThreshold ?? 0.3;
  const nmsThreshold = options.nmsThreshold ?? 0.3;
  const topK = options.topK ?? 5000;

  const scaledW = YU_NET_INPUT_SIZE - 2 * letterbox.offsetX;
  const scaledH = YU_NET_INPUT_SIZE - 2 * letterbox.offsetY;
  const scaleX = originalWidth / scaledW;
  const scaleY = originalHeight / scaledH;

  const candidates: YuNetFaceDetection[] = [];

  for (const stride of YU_NET_STRIDES) {
    const feat = YU_NET_INPUT_SIZE / stride;
    const cls = outputs[`cls_${stride}`]?.data;
    const obj = outputs[`obj_${stride}`]?.data;
    const bbox = outputs[`bbox_${stride}`]?.data;
    const kps = outputs[`kps_${stride}`]?.data;
    if (!cls || !obj || !bbox || !kps) continue;

    for (let r = 0; r < feat; r++) {
      for (let c = 0; c < feat; c++) {
        const idx = r * feat + c;

        const clsScore = clamp01(cls[idx]!);
        const objScore = clamp01(obj[idx]!);
        const score = Math.sqrt(clsScore * objScore);
        if (score < scoreThreshold) continue;

        const cx = (c + bbox[idx * 4]!) * stride;
        const cy = (r + bbox[idx * 4 + 1]!) * stride;
        const bw = Math.exp(bbox[idx * 4 + 2]!) * stride;
        const bh = Math.exp(bbox[idx * 4 + 3]!) * stride;
        const x1 = cx - bw / 2;
        const y1 = cy - bh / 2;

        const landmarks: YuNetLandmark[] = [];
        for (let n = 0; n < 5; n++) {
          landmarks.push({
            x: (kps[idx * 10 + 2 * n]! + c) * stride,
            y: (kps[idx * 10 + 2 * n + 1]! + r) * stride,
          });
        }

        candidates.push({
          box: {
            x: (x1 - letterbox.offsetX) * scaleX,
            y: (y1 - letterbox.offsetY) * scaleY,
            width: bw * scaleX,
            height: bh * scaleY,
          },
          landmarks: landmarks.map((lm) => ({
            x: (lm.x - letterbox.offsetX) * scaleX,
            y: (lm.y - letterbox.offsetY) * scaleY,
          })),
          score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const kept: YuNetFaceDetection[] = [];
  for (const candidate of candidates) {
    if (kept.length >= topK) break;
    if (kept.some((k) => intersectionOverUnion(k.box, candidate.box) >= nmsThreshold)) continue;
    kept.push(candidate);
  }

  return kept.map((face) => ({
    ...face,
    box: {
      x: Math.max(0, face.box.x),
      y: Math.max(0, face.box.y),
      width: Math.min(face.box.width, originalWidth),
      height: Math.min(face.box.height, originalHeight),
    },
  }));
}
