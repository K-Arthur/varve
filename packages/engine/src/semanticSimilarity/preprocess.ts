/**
 * Canonical, versioned preprocessing for semantic image embeddings.
 *
 * Every embedding producer (bench harness, reference pipeline, and the
 * inference worker's semantic model path) must use this exact pipeline so
 * vectors are comparable across machines and runtimes. The pipeline is
 * implemented in pure math — no canvas smoothing, no engine-dependent
 * resampler — and mirrored bit-for-bit by the Python reference pipeline
 * (scripts/semantic-corpus/reference-embeddings.py) used to generate the
 * committed reference vectors that the parity test checks against.
 *
 * Policy (semantic-rgb-letterbox-neutral-v2 for SigLIP):
 *   1. alpha matte onto neutral gray (128,128,128) at source resolution
 *   2. letterbox resize to the model input size (bilinear, half-pixel
 *      aligned, edges clamped)
 *   3. NCHW pack + per-channel normalize with the model's mean/std
 *
 * Policy (dinov2-rgb-center-crop-v1 for DINOv2):
 *   1. same neutral matte
 *   2. bilinear resize so the shortest edge equals 256
 *   3. center crop 224x224
 *   4. NCHW pack + ImageNet mean/std normalize
 *
 * The bilinear implementation intentionally stays separable-free and
 * simple: single-pass point sampling with half-pixel alignment, computed
 * in float64, so the Python port can match it exactly.
 */

export type SemanticPreprocessPolicy = 'letterbox' | 'shorter-side-center-crop';

export interface SemanticResizeSpec {
  /** Letterbox models: the square input side. */
  inputSize?: number;
  /** Shorter-side models: resize target for the shortest edge. */
  shortestEdge?: number;
  /** Center-crop side for shorter-side models. */
  cropSize?: number;
  /** Resize target dimensions for letterbox models (inputSize == both). */
  resizeWidth?: number;
  resizeHeight?: number;
  mean: [number, number, number];
  std: [number, number, number];
  paddingRgb: [number, number, number];
  policy: SemanticPreprocessPolicy;
}

export const SIGLIP_PREPROCESS_SPEC: SemanticResizeSpec = {
  inputSize: 224,
  policy: 'letterbox',
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  paddingRgb: [128, 128, 128],
};

export const DINOV2_PREPROCESS_SPEC: SemanticResizeSpec = {
  shortestEdge: 256,
  cropSize: 224,
  policy: 'shorter-side-center-crop',
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [128, 128, 128],
};

export const SEMANTIC_PREPROCESSING_VERSION_V2 = 'semantic-rgb-letterbox-neutral-v2';
export const DINOV2_PREPROCESSING_VERSION = 'dinov2-rgb-center-crop-v1';

/**
 * Composite RGBA onto a neutral matte and return opaque RGB as float64
 * (0..255) planes. Transparent design assets then always produce the same
 * input regardless of which browser/decoder composited them.
 */
export function matteToOpaqueRgb(imageData: {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}): Float64Array {
  const { width, height, data } = imageData;
  const out = new Float64Array(width * height * 3);
  const alphaMultiplier = 1 / 255;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = data[o + 3] ?? 255;
    const af = a * alphaMultiplier;
    const inv = 1 - af;
    out[i] = (data[o] ?? 0) * af + 128 * inv;
    out[width * height + i] = (data[o + 1] ?? 0) * af + 128 * inv;
    out[width * height * 2 + i] = (data[o + 2] ?? 0) * af + 128 * inv;
  }
  return out;
}

/**
 * Single-pass bilinear resize with half-pixel alignment and edge clamping.
 * Float64 throughout; the Python reference implements the same math.
 * `planes` is planar RGB float64 (R plane, then G, then B — the
 * matteToOpaqueRgb layout).
 */
export function resizeBilinearF64(
  planes: Float64Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Float64Array {
  const out = new Float64Array(dstWidth * dstHeight * 3);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  for (let c = 0; c < 3; c++) {
    const srcPlane = c * srcWidth * srcHeight;
    const dstPlane = c * dstWidth * dstHeight;
    for (let y = 0; y < dstHeight; y++) {
      const srcY = (y + 0.5) * yRatio - 0.5;
      const y0 = Math.max(0, Math.floor(srcY));
      const y1 = Math.min(srcHeight - 1, y0 + 1);
      const yf = Math.max(0, Math.min(1, srcY - y0));
      const row0 = y0 * srcWidth;
      const row1 = y1 * srcWidth;
      const dstRow = y * dstWidth;
      for (let x = 0; x < dstWidth; x++) {
        const srcX = (x + 0.5) * xRatio - 0.5;
        const x0 = Math.max(0, Math.floor(srcX));
        const x1 = Math.min(srcWidth - 1, x0 + 1);
        const xf = Math.max(0, Math.min(1, srcX - x0));
        const s0 = row0 + x0;
        const s1 = row0 + x1;
        const s2 = row1 + x0;
        const s3 = row1 + x1;
        const d = dstRow + x;
        const invX = 1 - xf;
        const invY = 1 - yf;
        const top = planes[srcPlane + s0]! * invX + planes[srcPlane + s1]! * xf;
        const bottom = planes[srcPlane + s2]! * invX + planes[srcPlane + s3]! * xf;
        out[dstPlane + d] = top * invY + bottom * yf;
      }
    }
  }
  return out;
}

/**
 * Letterbox-resize an opaque-RGB plane set into a square input, padding
 * with the spec's neutral color. Returns planes of `size`x`size`.
 */
export function letterboxF64(
  planes: Float64Array,
  srcWidth: number,
  srcHeight: number,
  size: number,
  paddingRgb: [number, number, number],
): Float64Array {
  const scale = Math.min(size / srcWidth, size / srcHeight);
  const fitW = Math.max(1, Math.round(srcWidth * scale));
  const fitH = Math.max(1, Math.round(srcHeight * scale));
  const resized = resizeBilinearF64(planes, srcWidth, srcHeight, fitW, fitH);
  const out = new Float64Array(size * size * 3);
  const [pr, pg, pb] = paddingRgb;
  for (let i = 0; i < size * size; i++) {
    out[i] = pr;
    out[size * size + i] = pg;
    out[size * size * 2 + i] = pb;
  }
  const offsetX = Math.round((size - fitW) / 2);
  const offsetY = Math.round((size - fitH) / 2);
  for (let y = 0; y < fitH; y++) {
    const srcRow = y * fitW;
    const dstRow = (offsetY + y) * size + offsetX;
    for (let c = 0; c < 3; c++) {
      const srcPlane = resized.subarray(c * fitW * fitH, (c + 1) * fitW * fitH);
      const dstPlane = out.subarray(c * size * size, (c + 1) * size * size);
      for (let x = 0; x < fitW; x++) {
        dstPlane[dstRow + x] = srcPlane[srcRow + x]!;
      }
    }
  }
  return out;
}

/**
 * Resize so the shortest edge equals `shortestEdge`, then center-crop a
 * `cropSize` square. DINOv2's canonical evaluation preprocessing
 * (shortest-edge 256, center crop 224; bilinear rather than bicubic — a
 * documented contract decision).
 */
export function shorterSideCenterCropF64(
  planes: Float64Array,
  srcWidth: number,
  srcHeight: number,
  shortestEdge: number,
  cropSize: number,
): Float64Array {
  const shortest = Math.min(srcWidth, srcHeight);
  const scale = shortestEdge / shortest;
  const resizedW = Math.round(srcWidth * scale);
  const resizedH = Math.round(srcHeight * scale);
  const resized = resizeBilinearF64(planes, srcWidth, srcHeight, resizedW, resizedH);
  const offsetX = Math.round((resizedW - cropSize) / 2);
  const offsetY = Math.round((resizedH - cropSize) / 2);
  const out = new Float64Array(cropSize * cropSize * 3);
  for (let c = 0; c < 3; c++) {
    const srcPlane = resized.subarray(c * resizedW * resizedH, (c + 1) * resizedW * resizedH);
    const dstPlane = out.subarray(c * cropSize * cropSize, (c + 1) * cropSize * cropSize);
    for (let y = 0; y < cropSize; y++) {
      const srcRow = (offsetY + y) * resizedW + offsetX;
      const dstRow = y * cropSize;
      for (let x = 0; x < cropSize; x++) {
        dstPlane[dstRow + x] = srcPlane[srcRow + x]!;
      }
    }
  }
  return out;
}

/** Pack an opaque-RGB plane set into a normalized NCHW float32 tensor. */
export function packNchwNormalizeF32(
  planes: Float64Array,
  width: number,
  height: number,
  spec: Pick<SemanticResizeSpec, 'mean' | 'std'>,
): Float32Array {
  const pixelCount = width * height;
  const result = new Float32Array(pixelCount * 3);
  const inv255 = 1 / 255;
  for (let c = 0; c < 3; c++) {
    const plane = planes.subarray(c * pixelCount, (c + 1) * pixelCount);
    const out = result.subarray(c * pixelCount, (c + 1) * pixelCount);
    const mean = spec.mean[c]!;
    const std = spec.std[c]!;
    for (let i = 0; i < pixelCount; i++) {
      out[i] = (plane[i]! * inv255 - mean) / std;
    }
  }
  return result;
}

export interface SemanticInput {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface PreprocessResult {
  tensor: Float32Array;
  width: number;
  height: number;
  /** Resize policy used, for diagnostics. */
  policy: SemanticPreprocessPolicy;
}

/**
 * Run the canonical preprocessing pipeline for a model spec and return the
 * model-ready NCHW tensor. This is the single entry point every semantic
 * producer uses.
 */
export function preprocessSemanticInput(
  input: SemanticInput,
  spec: SemanticResizeSpec,
): PreprocessResult {
  const rgb = matteToOpaqueRgb(input);
  let planes: Float64Array;
  let outWidth: number;
  let outHeight: number;
  if (spec.policy === 'letterbox') {
    const size = spec.inputSize ?? Math.max(spec.resizeWidth ?? 224, spec.resizeHeight ?? 224);
    planes = letterboxF64(rgb, input.width, input.height, size, spec.paddingRgb);
    outWidth = size;
    outHeight = size;
  } else {
    const crop = spec.cropSize ?? 224;
    planes = shorterSideCenterCropF64(
      rgb,
      input.width,
      input.height,
      spec.shortestEdge ?? 256,
      crop,
    );
    outWidth = crop;
    outHeight = crop;
  }
  return {
    tensor: packNchwNormalizeF32(planes, outWidth, outHeight, spec),
    width: outWidth,
    height: outHeight,
    policy: spec.policy,
  };
}
