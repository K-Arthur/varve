import type { DepthMap } from './depthMap';

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
  /** Reject farther samples across a depth edge to protect foreground contours. */
  edgeProtection?: number;
}

/**
 * Depth-aware gather blur. The gather is premultiplied-alpha and asymmetric at
 * depth discontinuities: a foreground pixel may gather nearer samples, but it
 * does not gather farther background samples across its silhouette. That
 * prevents the bright/dark halos produced by choosing independent Gaussian
 * levels per pixel.
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

  const focalDepth = Math.max(0, Math.min(1, options.focalDepth));
  const transitionRange = Math.max(0, Math.min(1, options.transitionRange));
  const invert = options.invert ?? false;
  const edgeProtection = Math.max(0, Math.min(1, options.edgeProtection ?? 0.035));
  const output = new Uint8ClampedArray(imageData.data.length);
  const radius = Math.max(1, Math.ceil(blurAmount));
  const stride = radius > 18 ? 2 : 1;
  const sigma = Math.max(0.75, radius / 2.5);
  const sigma2 = 2 * sigma * sigma;

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
          const fartherThanForeground = sampleDepth > centerDepth + edgeProtection;
          if (fartherThanForeground) continue;
          const spatialWeight = Math.exp(-(ox * ox + oy * oy) / sigma2);
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
