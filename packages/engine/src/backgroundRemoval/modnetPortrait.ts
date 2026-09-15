/**
 * MODNet photographic-portrait matting.
 *
 * Upstream contract (verified 2026-09-15 against ZHKKKe/MODNet `onnx/` and
 * Xenova/modnet @ fa2fa546052fba4c08921230a26cc69a333fca12):
 *
 *   `onnx/export_onnx.py` exports the official
 *   `modnet_photographic_portrait_matting.ckpt` as a dynamic-shape graph
 *   `input: [N,3,H,W] -> output: [N,1,H,W]`.
 *
 *   `onnx/inference_onnx.py` defines the preprocessing policy:
 *     1. RGB, channels unified to 3, no padding.
 *     2. `(pixel - 127.5) / 127.5` (pixel in 0..255) — [-1, 1].
 *     3. `get_scale_factor`: if `max(h,w) < 512` or `min(h,w) > 512`, scale so
 *        the longer edge is exactly 512 while preserving aspect; otherwise keep
 *        the original size. Then floor both dimensions to a multiple of 32.
 *     4. `cv2.resize(..., INTER_AREA)`.
 *   The matte is `squeeze(output)`, already in [0,1] (the exported module owns
 *   the sigmoid — upstream multiplies by 255 without another activation), then
 *   resized back to the source with `INTER_AREA`.
 *
 * This module is the provider-neutral implementation of that contract plus the
 * two deliberate extensions Varve needs:
 *
 *   - `decodeModnetAlpha` accepts the raw graph output, validates finiteness,
 *     and applies a sigmoid only when the tensor is outside [0,1]. That
 *     defensive branch exists for exports whose graph omits the activation;
 *     a normal export must not be sigmoid-ed twice.
 *   - `constrainPortraitAlpha` fuses a reviewed coarse constraint mask with the
 *     portrait matte without multiplying two soft estimates: outside the
 *     constraint's support the matte is forced to background, inside it the
 *     model's fractional alpha is preserved byte-for-byte. This is how a
 *     user-selected instance excludes a neighbouring person while hair and
 *     veil edges keep their fractional coverage.
 */

export const MODNET_REFERENCE_SIZE = 512;
export const MODNET_SIZE_DIVISIBILITY = 32;
export const MODNET_PREPROCESSING_VERSION = 'modnet-portrait-ref512-area-v1';
export const MODNET_MODEL_ID = 'modnet-portrait';

export interface ModnetDimensions {
  width: number;
  height: number;
}

/**
 * Upstream `get_scale_factor` + the multiple-of-32 constraint.
 *
 * The result is the exact model input geometry. It is allowed to be larger
 * than the source (a 300x200 portrait is upscaled to 512x320) and smaller
 * (a 4000x3000 photo is downscaled to 512x384), matching upstream.
 */
export function modnetInputDimensions(sourceWidth: number, sourceHeight: number): ModnetDimensions {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('MODNet source dimensions must be positive integers');
  }
  let width = sourceWidth;
  let height = sourceHeight;
  const longEdge = Math.max(sourceHeight, sourceWidth);
  const shortEdge = Math.min(sourceHeight, sourceWidth);
  if (longEdge < MODNET_REFERENCE_SIZE || shortEdge > MODNET_REFERENCE_SIZE) {
    if (sourceWidth >= sourceHeight) {
      height = MODNET_REFERENCE_SIZE;
      width = Math.trunc((sourceWidth / sourceHeight) * MODNET_REFERENCE_SIZE);
    } else {
      width = MODNET_REFERENCE_SIZE;
      height = Math.trunc((sourceHeight / sourceWidth) * MODNET_REFERENCE_SIZE);
    }
  }
  width -= width % MODNET_SIZE_DIVISIBILITY;
  height -= height % MODNET_SIZE_DIVISIBILITY;
  return {
    width: Math.max(MODNET_SIZE_DIVISIBILITY, width),
    height: Math.max(MODNET_SIZE_DIVISIBILITY, height),
  };
}

interface AreaWeights {
  /** start index in source space for each target pixel */
  start: Int32Array;
  /** integer source length covered by each target pixel (clamped) */
  length: Int32Array;
  /** fractional weights, `length[x]` per target pixel */
  weights: Float64Array[] | Float64Array;
}

function buildAreaWeights(sourceSize: number, targetSize: number): AreaWeights {
  const start = new Int32Array(targetSize);
  const length = new Int32Array(targetSize);
  const weights: Float64Array[] = new Array(targetSize);
  const scale = sourceSize / targetSize;
  for (let index = 0; index < targetSize; index += 1) {
    const from = index * scale;
    const to = (index + 1) * scale;
    const first = Math.max(0, Math.floor(from));
    const last = Math.min(sourceSize - 1, Math.ceil(to) - 1);
    const count = Math.max(1, last - first + 1);
    const row = new Float64Array(count);
    let total = 0;
    for (let sourceIndex = first; sourceIndex <= last; sourceIndex += 1) {
      const overlap = Math.min(to, sourceIndex + 1) - Math.max(from, sourceIndex);
      row[sourceIndex - first] = Math.max(0, overlap);
      total += row[sourceIndex - first]!;
    }
    if (total <= 0) {
      row[0] = 1;
      total = 1;
    }
    for (let i = 0; i < count; i += 1) row[i] = row[i]! / total;
    start[index] = first;
    length[index] = count;
    weights[index] = row;
  }
  return { start, length, weights: weights as unknown as Float64Array[] };
}

/**
 * OpenCV `INTER_AREA` resize for a single float plane.
 *
 * Downscaling is a true area average with fractional pixel overlaps (the same
 * arithmetic OpenCV uses, not an integer-box approximation), so resizing to
 * the 512-edge reference then back reproduces the upstream pipeline.
 *
 * Upscaling uses nearest-neighbour sampling, which is what OpenCV documents
 * `INTER_AREA` to degenerate to when zooming.
 */
export function resizeAlphaArea(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    source.length !== sourceWidth * sourceHeight
  ) {
    throw new Error('MODNet alpha source dimensions do not match the data length');
  }
  if (
    !Number.isSafeInteger(targetWidth) ||
    !Number.isSafeInteger(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error('MODNet alpha target dimensions must be positive integers');
  }
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return new Float32Array(source);
  }
  const output = new Float32Array(targetWidth * targetHeight);
  if (targetWidth <= sourceWidth && targetHeight <= sourceHeight) {
    const xWeights = buildAreaWeights(sourceWidth, targetWidth);
    const yWeights = buildAreaWeights(sourceHeight, targetHeight);
    for (let y = 0; y < targetHeight; y += 1) {
      const yStart = yWeights.start[y]!;
      const yLength = yWeights.length[y]!;
      const yRow = yWeights.weights[y] as Float64Array;
      for (let x = 0; x < targetWidth; x += 1) {
        const xStart = xWeights.start[x]!;
        const xLength = xWeights.length[x]!;
        const xRow = xWeights.weights[x] as Float64Array;
        let sum = 0;
        for (let sy = 0; sy < yLength; sy += 1) {
          const wy = yRow[sy]!;
          if (wy === 0) continue;
          const row = (yStart + sy) * sourceWidth;
          let rowSum = 0;
          for (let sx = 0; sx < xLength; sx += 1) {
            const wx = xRow[sx]!;
            if (wx === 0) continue;
            rowSum += (source[row + xStart + sx] ?? 0) * wx;
          }
          sum += rowSum * wy;
        }
        output[y * targetWidth + x] = sum;
      }
    }
    return output;
  }
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / targetWidth));
      output[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX]!;
    }
  }
  return output;
}

/**
 * Resize with the same area semantics as `resizeAlphaArea` for three-channel
 * image data, then pack NCHW in the upstream [-1,1] range.
 */
export function preprocessModnetImageData(
  imageData: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  dimensions = modnetInputDimensions(imageData.width, imageData.height),
): { tensor: Float32Array; width: number; height: number } {
  if (
    imageData.data.length < imageData.width * imageData.height * 4 ||
    imageData.width <= 0 ||
    imageData.height <= 0
  ) {
    throw new Error('MODNet source image data does not match its dimensions');
  }
  const { width: targetWidth, height: targetHeight } = dimensions;
  const plane = targetWidth * targetHeight;
  const tensor = new Float32Array(plane * 3);
  const downscale = targetWidth <= imageData.width && targetHeight <= imageData.height;
  if (downscale) {
    const xWeights = buildAreaWeights(imageData.width, targetWidth);
    const yWeights = buildAreaWeights(imageData.height, targetHeight);
    for (let y = 0; y < targetHeight; y += 1) {
      const yStart = yWeights.start[y]!;
      const yLength = yWeights.length[y]!;
      const yRow = yWeights.weights[y] as Float64Array;
      for (let x = 0; x < targetWidth; x += 1) {
        const xStart = xWeights.start[x]!;
        const xLength = xWeights.length[x]!;
        const xRow = xWeights.weights[x] as Float64Array;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < yLength; sy += 1) {
          const wy = yRow[sy]!;
          if (wy === 0) continue;
          const row = (yStart + sy) * imageData.width;
          for (let sx = 0; sx < xLength; sx += 1) {
            const wx = xRow[sx]!;
            if (wx === 0) continue;
            const weight = wx * wy;
            const at = (row + xStart + sx) * 4;
            r += (imageData.data[at] ?? 0) * weight;
            g += (imageData.data[at + 1] ?? 0) * weight;
            b += (imageData.data[at + 2] ?? 0) * weight;
          }
        }
        const index = y * targetWidth + x;
        tensor[index] = r / 127.5 - 1;
        tensor[plane + index] = g / 127.5 - 1;
        tensor[plane * 2 + index] = b / 127.5 - 1;
      }
    }
    return { tensor, width: targetWidth, height: targetHeight };
  }
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      imageData.height - 1,
      Math.floor((y * imageData.height) / targetHeight),
    );
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        imageData.width - 1,
        Math.floor((x * imageData.width) / targetWidth),
      );
      const at = (sourceY * imageData.width + sourceX) * 4;
      const index = y * targetWidth + x;
      tensor[index] = (imageData.data[at] ?? 0) / 127.5 - 1;
      tensor[plane + index] = (imageData.data[at + 1] ?? 0) / 127.5 - 1;
      tensor[plane * 2 + index] = (imageData.data[at + 2] ?? 0) / 127.5 - 1;
    }
  }
  return { tensor, width: targetWidth, height: targetHeight };
}

export type ModnetAlphaDecode = {
  alpha: Float32Array;
  width: number;
  height: number;
  /** True when the graph output was outside [0,1] and a sigmoid was applied. */
  activationApplied: boolean;
};

/**
 * Decode the graph output `[1,1,H,W]` (or relaxed `[1,H,W]` / `[H,W]`).
 *
 * The official export applies its own sigmoid, so the normal path is a clamp.
 * A tensor with values outside [0,1] is treated as raw logits and sigmoid-ed
 * once, with `activationApplied` reported so diagnostics can distinguish the
 * two contracts instead of silently double-activating.
 */
export function decodeModnetAlpha(data: Float32Array, dims: readonly number[]): ModnetAlphaDecode {
  if (!(data instanceof Float32Array)) {
    throw new Error('MODNet output must be a Float32Array');
  }
  let height: number;
  let width: number;
  if (dims.length === 4 && dims[0] === 1 && dims[1] === 1) {
    height = dims[2]!;
    width = dims[3]!;
  } else if (dims.length === 3 && dims[0] === 1) {
    height = dims[1]!;
    width = dims[2]!;
  } else if (dims.length === 2) {
    height = dims[0]!;
    width = dims[1]!;
  } else {
    throw new Error(`MODNet output has an unsupported shape [${dims.join(', ')}]`);
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height !== data.length
  ) {
    throw new Error('MODNet output dimensions do not match the data length');
  }
  const epsilon = 1e-4;
  let needsActivation = false;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i]!;
    if (!Number.isFinite(value)) {
      throw new Error('MODNet output contains a non-finite value');
    }
    if (value < -epsilon || value > 1 + epsilon) {
      needsActivation = true;
      break;
    }
  }
  const alpha = new Float32Array(data.length);
  if (needsActivation) {
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i]!;
      alpha[i] = 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, value))));
    }
  } else {
    for (let i = 0; i < data.length; i += 1) {
      alpha[i] = Math.max(0, Math.min(1, data[i]!));
    }
  }
  return { alpha, width, height, activationApplied: needsActivation };
}

export interface PortraitConstraintOptions {
  /**
   * Support dilation radius in mask pixels. A reviewed coarse selection is
   * expanded by this many pixels so a sliver of genuine portrait edge just
   * outside the coarse boundary is not cut off; its confident interior is the
   * only region trusted to suppress anything.
   */
  supportRadius?: number;
  /**
   * Coverage (0-255) at/above which a constraint pixel is definite subject.
   * Below it the pixel is only in the unknown/allowed band.
   */
  foregroundThreshold?: number;
}

/**
 * Constrain a portrait matte with a reviewed coarse mask.
 *
 * Semantics: the constraint is a *support*, not a second alpha estimate.
 *
 *   - outside `dilate(constraint, supportRadius)` → 0 (excluded neighbour or
 *     background is removed even when MODNet covered it);
 *   - inside the support → the MODNet alpha is preserved exactly.
 *
 * No multiplication happens, so a hair edge inside the support keeps its
 * fractional coverage exactly as the model produced it; a neighbouring person
 * outside the support stays excluded without eroding the subject's boundary.
 */
export function constrainPortraitAlpha(
  alpha: Float32Array,
  width: number,
  height: number,
  constraint: Uint8Array,
  options: PortraitConstraintOptions = {},
): Float32Array {
  if (alpha.length !== width * height || constraint.length !== width * height) {
    throw new Error('MODNet constraint dimensions do not match the alpha plane');
  }
  const supportRadius = Math.max(0, Math.floor(options.supportRadius ?? 2));
  const foregroundThreshold = options.foregroundThreshold ?? 128;
  const foreground = new Uint8Array(width * height);
  for (let i = 0; i < foreground.length; i += 1) {
    foreground[i] = (constraint[i] ?? 0) >= foregroundThreshold ? 1 : 0;
  }
  const supported = dilateBinary(foreground, width, height, supportRadius);
  const result = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    result[i] = supported[i] ? alpha[i]! : 0;
  }
  return result;
}

function dilateBinary(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return source;
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let hit = 0;
      const from = Math.max(0, x - radius);
      const to = Math.min(width - 1, x + radius);
      for (let sx = from; sx <= to && !hit; sx += 1) hit = source[row + sx]!;
      horizontal[row + x] = hit;
    }
  }
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const from = Math.max(0, y - radius);
    const to = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      let hit = 0;
      for (let sy = from; sy <= to && !hit; sy += 1) hit = horizontal[sy * width + x]!;
      output[y * width + x] = hit;
    }
  }
  return output;
}
