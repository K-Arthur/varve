/**
 * YuNet face detection (OpenCV face_detection_yunet_2023mar) — a compact,
 * MIT-licensed single-stage face detector with 5 facial keypoints per face.
 * Enables FACE_BOUNDS + FACE_KEYPOINTS for the visual-awareness subsystem
 * (face-aware crop, "Protect Faces", person selection anchors).
 *
 * Model: opencv/face_detection_yunet_2023mar.onnx (MIT). The bundled graph has
 * a FIXED [1,3,640,640] input (verified with onnxruntime-node 1.27 on the
 * checked-in artifact — a 480x640 feed is rejected), so callers must letterbox
 * or run bounded windows at native scale (see vision/faceWindows.ts).
 *
 * Preprocessing contract (verified against the upstream predictor):
 *   inputs:  input [1,3,640,640] float32, BGR channel order, raw pixel values
 *            in [0,255]. OpenCV's reference path is
 *            `blobFromImage(pad_image)` with default scalefactor/mean/swapRB,
 *            which packs the BGR Mat's own channel order and does NOT
 *            normalize. Measured 2026-09-15 on rights-cleared fixtures: the
 *            BGR order matches the reference scores exactly on strong faces and
 *            scores higher on a group scene, while the swapped (RGB) order
 *            produced 11 borderline false detections on a textured facade that
 *            BGR reduced to 1 (evidence: docs/audits/face-detection-refinement-2026-09-15.md).
 *   outputs: cls_8|16|32 [1,rows*cols,1], obj_8|16|32 [1,rows*cols,1],
 *            bbox_8|16|32 [1,rows*cols,4], kps_8|16|32 [1,rows*cols,10].
 *
 * Postprocess mirrors OpenCV modules/objdetect/src/face_detect.cpp and
 * modules/dnn/src/nms.inl.hpp:
 *   - score = sqrt(clamp(cls,0,1) * clamp(obj,0,1)); keep while score >= scoreThreshold (strictly
 *     greater than the threshold once inside NMS, matching GetMaxScoreIndex);
 *   - candidate boxes are `int()`-truncated before suppression, exactly like
 *     `Rect2i(int(x), int(y), int(w), int(h))` in the upstream implementation;
 *   - `topK` is a PRE-suppression candidate cap ("Keep top_k bounding boxes
 *     before NMS"), not a post-suppression limit;
 *   - greedy suppression with `overlap <= nmsThreshold`, eta = 1 (constant
 *     threshold), stable score-descending order (deterministic tie handling).
 * Malformed output (missing/short/mis-shaped tensors, non-finite values,
 * overflowing exponential box sizes) raises a typed FaceDecodeError instead of
 * degrading into a successful "no faces" result.
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
  // packNchwTensor computes (pixel/255 - mean) / std. OpenCV feeds raw
  // [0,255] values with no mean subtraction, so use std = 1/255, mean 0.
  mean: [0, 0, 0],
  std: [1 / 255, 1 / 255, 1 / 255],
  paddingRgb: [0, 0, 0],
  // The reference predictor packs the BGR plane order (blobFromImage with
  // swapRB=false). See the module docstring for the measured evidence.
  channelOrder: 'bgr',
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
  /**
   * Five keypoints in original-image pixel space. Coordinates outside the
   * source frame are preserved as the model's estimate (never clamped to the
   * border); consumers decide validity from the frame and `landmarksInFrame`.
   */
  landmarks: readonly YuNetLandmark[];
  /** True for each landmark that lies inside the source frame. */
  landmarksInFrame: readonly boolean[];
  score: number;
}

export interface DecodeFaceOptions {
  /** Minimum score = sqrt(clamp(cls)*clamp(obj)) to keep a candidate. */
  scoreThreshold?: number;
  /** IoU above which overlapping faces are suppressed. */
  nmsThreshold?: number;
  /**
   * Pre-suppression candidate cap (OpenCV `top_k` semantics). Applied after
   * score-descending sort and before greedy suppression.
   */
  topK?: number;
}

export type FaceDecodeErrorCode = 'FACE_OUTPUT_MALFORMED' | 'FACE_INPUT_INVALID';

/** Typed failure for malformed tensors or impossible geometry. */
export class FaceDecodeError extends Error {
  constructor(
    readonly code: FaceDecodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FaceDecodeError';
  }
}

export interface FaceOutputTensor {
  data: Float32Array;
  dims: readonly number[];
}

export type FaceOutputTensors = Record<string, FaceOutputTensor | undefined>;

function malformed(message: string): FaceDecodeError {
  return new FaceDecodeError('FACE_OUTPUT_MALFORMED', `YuNet output malformed: ${message}`);
}

function invalidInput(message: string): FaceDecodeError {
  return new FaceDecodeError('FACE_INPUT_INVALID', `YuNet input invalid: ${message}`);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
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

/** C++ `int(float)` truncates toward zero; OpenCV feeds Rect2i boxes to NMS. */
function truncateToInt(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

/**
 * Read one stride's tensor and validate its declared shape and storage length.
 * A missing, mis-shaped, or short tensor is a malformed model response — not a
 * document with no faces.
 */
function requireTensor(
  outputs: FaceOutputTensors,
  name: string,
  cells: number,
  channels: number,
): Float32Array {
  const tensor = outputs[name];
  if (!tensor || !(tensor.data instanceof Float32Array)) {
    throw malformed(`missing tensor ${name}`);
  }
  const dims = tensor.dims;
  if (dims.length !== 3 || dims[0] !== 1 || dims[1] !== cells || dims[2] !== channels) {
    throw malformed(
      `tensor ${name} has dims [${dims.join(',')}] but expected [1,${cells},${channels}]`,
    );
  }
  if (tensor.data.length !== cells * channels) {
    throw malformed(
      `tensor ${name} has ${tensor.data.length} values, expected ${cells * channels}`,
    );
  }
  return tensor.data;
}

interface Candidate {
  modelBox: { x: number; y: number; width: number; height: number };
  score: number;
  modelLandmarks: readonly YuNetLandmark[];
}

/**
 * Decode YuNet's raw output tensors into filtered detections in
 * original-image pixel coordinates. `letterbox` must be the transform the
 * image actually went through during preprocessing (from
 * WorkerInferResult.outputs.letterbox) — omitting it for a non-square source
 * reproduces the SAM2/DETR coordinate bug class.
 */
export function decodeFaceDetections(
  outputs: FaceOutputTensors,
  originalWidth: number,
  originalHeight: number,
  letterbox: { offsetX: number; offsetY: number } = { offsetX: 0, offsetY: 0 },
  options: DecodeFaceOptions = {},
): YuNetFaceDetection[] {
  if (!finitePositive(originalWidth) || !finitePositive(originalHeight)) {
    throw invalidInput(
      `source dimensions must be positive finite numbers, got ${originalWidth}x${originalHeight}`,
    );
  }

  const scoreThreshold = Number.isFinite(options.scoreThreshold)
    ? Math.max(0, options.scoreThreshold!)
    : 0.3;
  const nmsThreshold = Number.isFinite(options.nmsThreshold)
    ? Math.max(0, options.nmsThreshold!)
    : 0.3;
  const topK = Number.isFinite(options.topK) ? Math.max(1, Math.floor(options.topK!)) : 5000;

  const offsetX = Number.isFinite(letterbox.offsetX) ? letterbox.offsetX : Number.NaN;
  const offsetY = Number.isFinite(letterbox.offsetY) ? letterbox.offsetY : Number.NaN;
  const scaledW = YU_NET_INPUT_SIZE - 2 * offsetX;
  const scaledH = YU_NET_INPUT_SIZE - 2 * offsetY;
  if (!finitePositive(scaledW) || !finitePositive(scaledH) || offsetX < 0 || offsetY < 0) {
    throw invalidInput(
      `letterbox offsets (${letterbox.offsetX}, ${letterbox.offsetY}) leave no usable content area`,
    );
  }
  const scaleX = originalWidth / scaledW;
  const scaleY = originalHeight / scaledH;

  const candidates: Candidate[] = [];

  for (const stride of YU_NET_STRIDES) {
    const feat = YU_NET_INPUT_SIZE / stride;
    const cells = feat * feat;

    const cls = requireTensor(outputs, `cls_${stride}`, cells, 1);
    const obj = requireTensor(outputs, `obj_${stride}`, cells, 1);
    const bbox = requireTensor(outputs, `bbox_${stride}`, cells, 4);
    const kps = requireTensor(outputs, `kps_${stride}`, cells, 10);

    for (let i = 0; i < cells; i += 1) {
      const clsRaw = cls[i]!;
      const objRaw = obj[i]!;
      if (!Number.isFinite(clsRaw) || !Number.isFinite(objRaw)) {
        throw malformed(`non-finite class/object score in ${stride}px grid cell ${i}`);
      }
      const score = Math.sqrt(clamp01(clsRaw) * clamp01(objRaw));
      if (score < scoreThreshold) continue;
      if (score <= scoreThreshold) continue; // matches GetMaxScoreIndex `> threshold`

      const r = Math.floor(i / feat);
      const c = i - r * feat;

      const offsetXInCell = bbox[i * 4]!;
      const offsetYInCell = bbox[i * 4 + 1]!;
      const logWidth = bbox[i * 4 + 2]!;
      const logHeight = bbox[i * 4 + 3]!;
      if (
        !Number.isFinite(offsetXInCell) ||
        !Number.isFinite(offsetYInCell) ||
        !Number.isFinite(logWidth) ||
        !Number.isFinite(logHeight)
      ) {
        throw malformed(`non-finite box regression in ${stride}px grid cell ${i}`);
      }

      const centerX = (c + offsetXInCell) * stride;
      const centerY = (r + offsetYInCell) * stride;
      const width = Math.exp(logWidth) * stride;
      const height = Math.exp(logHeight) * stride;
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw malformed(`box size overflowed in ${stride}px grid cell ${i}`);
      }

      const landmarks: YuNetLandmark[] = [];
      for (let n = 0; n < 5; n += 1) {
        const lx = kps[i * 10 + 2 * n]!;
        const ly = kps[i * 10 + 2 * n + 1]!;
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) {
          throw malformed(`non-finite landmark ${n} in ${stride}px grid cell ${i}`);
        }
        landmarks.push({ x: (lx + c) * stride, y: (ly + r) * stride });
      }

      candidates.push({
        modelBox: {
          x: centerX - width / 2,
          y: centerY - height / 2,
          width,
          height,
        },
        score,
        modelLandmarks: landmarks,
      });
    }
  }

  // Stable sort keeps stride/row/column discovery order for equal scores, so
  // suppression is deterministic for a given tensor set.
  const order = candidates.map((_, index) => index);
  order.sort((a, b) => candidates[b]!.score - candidates[a]!.score);
  if (order.length > topK) order.length = topK;

  const truncated = order.map((index) => {
    const box = candidates[index]!.modelBox;
    return {
      x: truncateToInt(box.x),
      y: truncateToInt(box.y),
      width: truncateToInt(box.width),
      height: truncateToInt(box.height),
    };
  });

  const kept: Candidate[] = [];
  const keptBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let position = 0; position < order.length; position += 1) {
    const box = truncated[position]!;
    let keep = true;
    // Suppression compares against the truncated boxes of already-kept
    // candidates, exactly like NMSFast_ with eta = 1.
    for (let k = 0; k < keptBoxes.length && keep; k += 1) {
      keep = intersectionOverUnion(box, keptBoxes[k]!) <= nmsThreshold;
    }
    if (keep) {
      kept.push(candidates[order[position]!]!);
      keptBoxes.push(box);
    }
  }

  const detections: YuNetFaceDetection[] = [];
  for (const candidate of kept) {
    const mapped: YuNetFaceDetection = {
      box: {
        x: (candidate.modelBox.x - offsetX) * scaleX,
        y: (candidate.modelBox.y - offsetY) * scaleY,
        width: candidate.modelBox.width * scaleX,
        height: candidate.modelBox.height * scaleY,
      },
      landmarks: candidate.modelLandmarks.map((landmark) => ({
        x: (landmark.x - offsetX) * scaleX,
        y: (landmark.y - offsetY) * scaleY,
      })),
      landmarksInFrame: [],
      score: candidate.score,
    };
    const clipped = clipFaceDetectionToFrame(mapped, originalWidth, originalHeight);
    if (clipped) detections.push(clipped);
  }
  return detections;
}

/**
 * Clip a source-space detection to the source frame using true rectangle
 * intersection. Returns null for a degenerate (empty) intersection so a fully
 * off-image candidate never becomes a zero-size "face" at the border.
 */
export function clipFaceDetectionToFrame(
  detection: YuNetFaceDetection,
  width: number,
  height: number,
): YuNetFaceDetection | null {
  const x0 = Math.max(0, Math.min(width, detection.box.x));
  const y0 = Math.max(0, Math.min(height, detection.box.y));
  const x1 = Math.max(0, Math.min(width, detection.box.x + detection.box.width));
  const y1 = Math.max(0, Math.min(height, detection.box.y + detection.box.height));
  const clippedWidth = x1 - x0;
  const clippedHeight = y1 - y0;
  if (!(clippedWidth > 0) || !(clippedHeight > 0)) return null;
  return {
    ...detection,
    box: { x: x0, y: y0, width: clippedWidth, height: clippedHeight },
    landmarksInFrame: detection.landmarks.map(
      (landmark) =>
        landmark.x >= 0 && landmark.y >= 0 && landmark.x <= width && landmark.y <= height,
    ),
  };
}
