/**
 * PaddleOCR text detection — locates text regions in an image (useful
 * standalone for redaction/accessibility workflows, and as the
 * foundation for full OCR).
 *
 * Scoped to DETECTION ONLY for this pass. Full OCR needs two more
 * models (angle classification + text recognition) plus a per-language
 * character-dictionary asset (rec_keys_path / dict.txt) that isn't
 * wired up yet — recognition without the matching dictionary silently
 * produces garbage output, so it's a documented follow-up rather than a
 * half-verified 3-stage pipeline.
 *
 * Model: PP-OCRv4 detection (Apache-2.0, PaddlePaddle/PaddleOCR, Baidu).
 * ONNX export: deepghs/paddleocr (det/ch_PP-OCRv4_det/model.onnx).
 * Verified 2026-07-21 by downloading the real graph:
 *   input: x [B,3,H,W] float32, fully dynamic H/W (fully convolutional —
 *     the DB/DBNet++ architecture has no fixed-size requirement, but its
 *     stride-32 downsampling means H and W should be padded to a
 *     multiple of 32 for correct upsampling back to full resolution)
 *   output: sigmoid_0.tmp_0 [B,1,H,W] — a per-pixel "is this near text"
 *     probability map (the DB algorithm's shrink map), already through
 *     Sigmoid. Turning this into actual text-region polygons needs
 *     thresholding + connected-component extraction + box "unclipping"
 *     (expanding the shrunk region back to the real text boundary) —
 *     implemented below as an axis-aligned bounding-box approximation
 *     (real DBNet postprocessing uses minimum-area rotated rectangles;
 *     axis-aligned is simpler and sufficient for "highlight text
 *     regions," not precise enough for feeding into a recognition model
 *     expecting a tightly-cropped, deskewed line).
 * Opset 11, ImageNet-style normalization (standard PaddleOCR preprocessing).
 */
import type { TensorSpec } from '../imageTensor';

export const PADDLE_DET_TENSOR_SPEC: TensorSpec = {
  inputWidth: 0,
  inputHeight: 0,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [0, 0, 0],
};

const STRIDE = 32;

/** Round a dimension up to the nearest multiple of the detector's stride
 * so the fully-convolutional network's downsample/upsample stays aligned. */
export function padToStride(dimension: number, stride = STRIDE): number {
  return Math.ceil(dimension / stride) * stride;
}

export interface TextRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Mean detection confidence within the region. */
  confidence: number;
}

/**
 * Decode the detector's per-pixel probability map into axis-aligned
 * text-region boxes via thresholding + flood-fill connected components.
 * `probThreshold` follows PaddleOCR's default (0.3 on the shrink map);
 * `minRegionArea` filters out single-pixel noise.
 */
export function decodeTextRegions(
  data: Float32Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  probThreshold = 0.3,
  minRegionArea = 16,
): TextRegion[] {
  const visited = new Uint8Array(width * height);
  const regions: TextRegion[] = [];
  const scaleX = targetWidth / width;
  const scaleY = targetHeight / height;

  for (let start = 0; start < width * height; start++) {
    if (visited[start] || data[start]! < probThreshold) continue;

    // Flood fill (4-connected) to find this component's extent.
    const stack = [start];
    visited[start] = 1;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sum = 0;
    let count = 0;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      sum += data[idx]!;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Left/right neighbors must stay within the same row — checking only
      // "does n land in column 0 or width-1" (as a prior version of this
      // guard did) misfires for narrow grids, since a legitimate one-step
      // move can coincidentally land in the last column too.
      const left = x > 0 ? idx - 1 : -1;
      const right = x < width - 1 ? idx + 1 : -1;
      const neighbors = [left, right, idx - width, idx + width];
      for (const n of neighbors) {
        if (n < 0 || n >= width * height) continue;
        if (visited[n] || data[n]! < probThreshold) continue;
        visited[n] = 1;
        stack.push(n);
      }
    }

    if (count < minRegionArea) continue;

    regions.push({
      x: minX * scaleX,
      y: minY * scaleY,
      width: (maxX - minX + 1) * scaleX,
      height: (maxY - minY + 1) * scaleY,
      confidence: sum / count,
    });
  }

  return regions.sort((a, b) => a.y - b.y || a.x - b.x);
}
