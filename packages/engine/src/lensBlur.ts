import { type DepthMap, resizeDepthMap } from './depthMap';

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function depthToRadius(
  depthNorm: number,
  focalDepth: number,
  transitionRange: number,
  blurAmount: number,
  invert: boolean,
): number {
  const d = invert ? 1 - depthNorm : depthNorm;
  const diff = Math.abs(d - focalDepth);
  const inFocusRange = transitionRange * 0.5;
  if (diff <= inFocusRange) return 0;
  const t = Math.min(1, (diff - inFocusRange) / Math.max(0.001, 1 - inFocusRange));
  return t * blurAmount;
}

export function applyLensBlur(
  imageData: ImageData,
  depthMap: Uint8Array,
  options: {
    blurAmount: number;
    focalDepth: number;
    transitionRange: number;
    invert: boolean;
  },
): ImageData {
  // Legacy callers receive 8-bit maps where 255 was near. The reusable
  // DepthMap contract uses 0 = near, 1 = far, so adapt at this boundary.
  const values = new Float32Array(depthMap.length);
  const valid = new Uint8Array(depthMap.length).fill(1);
  for (let i = 0; i < depthMap.length; i++) values[i] = 1 - depthMap[i]! / 255;
  return applyDepthBlur(
    imageData,
    {
      width: imageData.width,
      height: imageData.height,
      values,
      valid,
      metadata: {
        depthType: 'relative',
        unit: 'normalized',
        nearFarConvention: 'nearIsLow',
        inferenceVersion: 1,
        preprocessingVersion: 1,
      },
    },
    { ...options, focalDepth: 1 - options.focalDepth },
  );
}

export interface DepthBlurOptions {
  /** Maximum gather radius in source pixels. */
  blurAmount: number;
  /** Canonical depth where 0 = near and 1 = far. */
  focalDepth: number;
  /** In-focus interval around the focal plane, normalized 0..1. */
  transitionRange: number;
  invert?: boolean;
  /**
   * Reject samples on the far side of a depth edge to protect foreground
   * contours. Governs both directions of the edge.
   */
  edgeProtection?: number;
}

/**
 * The gather is executed at most over this many pixels. Larger sources are
 * downscaled first (premultiplied, bilinear) so full-resolution renders do
 * not pay an O(width * height * radius^2) cost; the result is upscaled back.
 * The depth field and the occlusion rules are scale-invariant, so the
 * edge behaviour is preserved.
 */
const MAX_GATHER_PIXELS = 524_288;
const MIN_GATHER_SCALE = 0.25;

/** Premultiplied bilinear resize of raw RGBA pixels. */
function resizeRgbaPremultiplied(
  data: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(srcHeight - 1, Math.max(0, ((y + 0.5) * srcHeight) / height - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcHeight - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(srcWidth - 1, Math.max(0, ((x + 0.5) * srcWidth) / width - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcWidth - 1, x0 + 1);
      const tx = sx - x0;
      const o = (y * width + x) * 4;
      let aR = 0;
      let aG = 0;
      let aB = 0;
      let aA = 0;
      for (const [px, py, wy] of [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ] as const) {
        const i = (py * srcWidth + px) * 4;
        const a = data[i + 3]! / 255;
        aR += data[i]! * a * wy;
        aG += data[i + 1]! * a * wy;
        aB += data[i + 2]! * a * wy;
        aA += a * wy;
      }
      if (aA <= 0) {
        output[o] = 0;
        output[o + 1] = 0;
        output[o + 2] = 0;
        output[o + 3] = 0;
        continue;
      }
      output[o] = clampByte(aR / aA);
      output[o + 1] = clampByte(aG / aA);
      output[o + 2] = clampByte(aB / aA);
      output[o + 3] = clampByte(aA * 255);
    }
  }
  return output;
}

/**
 * Depth-aware gather blur. The gather is premultiplied-alpha and occlusion-aware
 * at depth discontinuities:
 *
 * - A sample farther than the center pixel never contributes: its light path
 *   is blocked by the center pixel's own (nearer) surface. This prevents the
 *   bright/dark halos produced by choosing independent Gaussian levels per
 *   pixel.
 * - A sample nearer than the center pixel contributes only when its own plane
 *   is out of focus (its light spreads). An in-focus plane keeps its light at
 *   its own pixels, so a sharp subject does not smear into the blurred
 *   background; an out-of-focus near plane still produces foreground bokeh.
 *
 * Sources above MAX_GATHER_PIXELS are processed at a reduced scale with a
 * premultiplied bilinear round trip; images at or below that size (including
 * every test fixture) are processed at full resolution.
 */
export function applyDepthBlur(
  imageData: ImageData,
  depthMap: DepthMap,
  options: DepthBlurOptions,
): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  if (depthMap.width !== w || depthMap.height !== h || depthMap.values.length !== w * h) {
    return new ImageData(new Uint8ClampedArray(imageData.data), w, h);
  }
  const blurAmount = Math.max(0, options.blurAmount);
  if (blurAmount <= 0) return new ImageData(new Uint8ClampedArray(imageData.data), w, h);

  const scale = Math.min(1, Math.max(MIN_GATHER_SCALE, Math.sqrt(MAX_GATHER_PIXELS / (w * h))));
  if (scale >= 1) {
    return gatherBlur(imageData, depthMap, options);
  }

  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const scaledInput = new ImageData(
    new Uint8ClampedArray(resizeRgbaPremultiplied(imageData.data, w, h, sw, sh)),
    sw,
    sh,
  );
  const scaledDepth = resizeDepthMap(depthMap, sw, sh);
  const scaledOutput = gatherBlur(scaledInput, scaledDepth, {
    ...options,
    blurAmount: blurAmount * (sw / w),
  });
  return new ImageData(
    new Uint8ClampedArray(resizeRgbaPremultiplied(scaledOutput.data, sw, sh, w, h)),
    w,
    h,
  );
}

function gatherBlur(
  imageData: ImageData,
  depthMap: DepthMap,
  options: DepthBlurOptions,
): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const blurAmount = Math.max(0, options.blurAmount);
  if (blurAmount <= 0) return new ImageData(new Uint8ClampedArray(imageData.data), w, h);

  const focalDepth = Math.max(0, Math.min(1, options.focalDepth));
  const transitionRange = Math.max(0, Math.min(1, options.transitionRange));
  const invert = options.invert ?? false;
  const edgeProtection = Math.max(0, Math.min(1, options.edgeProtection ?? 0.035));
  const output = new Uint8ClampedArray(imageData.data.length);
  const radius = Math.max(1, Math.ceil(blurAmount));
  const stride = radius > 14 ? 2 : 1;
  const sigma = Math.max(0.75, radius / 2.5);
  const sigma2 = 2 * sigma * sigma;

  // Precompute the spatial weights once per frame instead of calling
  // Math.exp for every candidate sample in the gather loop.
  const tableRadius = Math.floor(radius / stride) * stride;
  const weightStride = (tableRadius / stride) * 2 + 1;
  const weights = new Float32Array(weightStride * weightStride);
  for (let oy = -tableRadius; oy <= tableRadius; oy += stride) {
    for (let ox = -tableRadius; ox <= tableRadius; ox += stride) {
      weights[((oy + tableRadius) / stride) * weightStride + (ox + tableRadius) / stride] =
        Math.exp(-(ox * ox + oy * oy) / sigma2);
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      const centerDepth = depthMap.values[index] ?? 0.5;
      const canonicalDepth = invert ? 1 - centerDepth : centerDepth;
      const desiredRadius = depthToRadius(
        canonicalDepth,
        focalDepth,
        transitionRange,
        blurAmount,
        false,
      );
      const out = index * 4;
      if (!depthMap.valid[index] || desiredRadius < 0.5) {
        output[out] = imageData.data[out]!;
        output[out + 1] = imageData.data[out + 1]!;
        output[out + 2] = imageData.data[out + 2]!;
        output[out + 3] = imageData.data[out + 3]!;
        continue;
      }

      const sampleRadius = Math.max(1, Math.ceil(desiredRadius));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let sumWeight = 0;
      for (let oy = -sampleRadius; oy <= sampleRadius; oy += stride) {
        for (let ox = -sampleRadius; ox <= sampleRadius; ox += stride) {
          if (ox * ox + oy * oy > desiredRadius * desiredRadius) continue;
          const sx = Math.max(0, Math.min(w - 1, x + ox));
          const sy = Math.max(0, Math.min(h - 1, y + oy));
          const sampleIndex = sy * w + sx;
          if (!depthMap.valid[sampleIndex]) continue;
          const sampleDepth = depthMap.values[sampleIndex] ?? centerDepth;
          const sampleCanonicalDepth = invert ? 1 - sampleDepth : sampleDepth;
          const centerCanonicalDepth = invert ? 1 - centerDepth : centerDepth;
          const fartherThanCenter = sampleCanonicalDepth > centerCanonicalDepth + edgeProtection;
          if (fartherThanCenter) continue;
          const nearerThanCenter = sampleCanonicalDepth < centerCanonicalDepth - edgeProtection;
          if (nearerThanCenter) {
            // An in-focus nearer plane does not spread light to this pixel;
            // only an out-of-focus plane contributes foreground bokeh.
            const sampleBlurPx = depthToRadius(
              sampleCanonicalDepth,
              focalDepth,
              transitionRange,
              blurAmount,
              false,
            );
            if (sampleBlurPx < 1) continue;
          }
          const spatialWeight =
            weights[((oy + tableRadius) / stride) * weightStride + (ox + tableRadius) / stride]!;
          const px = sampleIndex * 4;
          const alpha = imageData.data[px + 3]! / 255;
          sumR += imageData.data[px]! * alpha * spatialWeight;
          sumG += imageData.data[px + 1]! * alpha * spatialWeight;
          sumB += imageData.data[px + 2]! * alpha * spatialWeight;
          sumA += alpha * spatialWeight;
          sumWeight += spatialWeight;
        }
      }
      if (sumWeight <= 0 || sumA <= 0) {
        output[out] = imageData.data[out]!;
        output[out + 1] = imageData.data[out + 1]!;
        output[out + 2] = imageData.data[out + 2]!;
        output[out + 3] = imageData.data[out + 3]!;
        continue;
      }
      const alpha = Math.max(0, Math.min(1, sumA / sumWeight));
      output[out] = clampByte(sumR / sumA);
      output[out + 1] = clampByte(sumG / sumA);
      output[out + 2] = clampByte(sumB / sumA);
      output[out + 3] = clampByte(alpha * 255);
    }
  }
  return new ImageData(output, w, h);
}

export function depthToHeatmapImageData(
  depthMap: Uint8Array,
  width: number,
  height: number,
  alpha = 160,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < depthMap.length; i++) {
    const d = depthMap[i]! / 255;
    const px = i * 4;
    let r: number;
    let g: number;
    let b: number;
    if (d < 0.25) {
      const t = d / 0.25;
      r = 0;
      g = Math.round(t * 255);
      b = 255;
    } else if (d < 0.5) {
      const t = (d - 0.25) / 0.25;
      r = 0;
      g = 255;
      b = Math.round((1 - t) * 255);
    } else if (d < 0.75) {
      const t = (d - 0.5) / 0.25;
      r = Math.round(t * 255);
      g = 255;
      b = 0;
    } else {
      const t = (d - 0.75) / 0.25;
      r = 255;
      g = Math.round((1 - t) * 255);
      b = 0;
    }
    data[px] = r;
    data[px + 1] = g;
    data[px + 2] = b;
    data[px + 3] = alpha;
  }
  return new ImageData(data, width, height);
}

export function depthToBlurWeight(
  depthNorm: number,
  focalDepth: number,
  transitionRange: number,
  invert: boolean,
): number {
  const d = invert ? 1 - depthNorm : depthNorm;
  const diff = Math.abs(d - focalDepth);
  const inFocusRange = transitionRange * 0.5;
  if (diff <= inFocusRange) return 0;
  return Math.min(1, (diff - inFocusRange) / Math.max(0.001, 1 - inFocusRange));
}
