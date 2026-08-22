/**
 * CPU image enlargement shared by browser and desktop webview targets.
 *
 * Research basis: W3C compositing requires interpolation in premultiplied-alpha
 * space; nearest-neighbor is retained for hard-edged pixel artwork. Bicubic
 * (Catmull-Rom) and Lanczos-3 provide higher-quality photographic enlargement.
 */

export type UpscaleMethod = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos3' | 'ai';

export type UpscaleProgressFn = (done: number, total: number) => void;

export type { RestorationOperation } from './restoration';

export type DenoiseStrength = 'none' | 'light' | 'medium' | 'strong';

export interface UpscaleOptions {
  /** Optional unified Enhance operation; omitted by legacy upscale callers. */
  operation?: import('./restoration').RestorationOperation;
  scale?: number;
  targetWidth?: number;
  targetHeight?: number;
  method?: UpscaleMethod;
  /** Upper bound for output allocation. Defaults to 64 megapixels. */
  maxPixels?: number;
  /** Real-ESRGAN model id when method is `ai`. */
  modelId?: string;
  /**
   * Per-tile progress callback for the native AI path. Fires on the main
   * thread roughly once per upscaled tile (a 1024px image yields ~225 tiles).
   */
  onProgress?: UpscaleProgressFn;
  /** When true, replaces the source image in place instead of creating a new layer. */
  replaceSource?: boolean;
  /**
   * When true, this is a preview request. For AI, the source is downsampled
   * to a max preview dimension (512px short edge) before inference to keep
   * the dialog responsive. For CPU modes, the preview runs at reduced resolution.
   */
  preview?: boolean;
  /** Max preview input dimension in pixels (short edge). Defaults to 512. */
  previewMaxDimension?: number;
  /** Denoise strength — applies SCUNet denoising before upscaling. */
  denoiseStrength?: DenoiseStrength;
  /** Pixel-art algorithm to use when method is 'nearest' (pixel-art mode). */
  pixelArtAlgorithm?: import('./pixelArtScaling').PixelArtAlgorithm;
  /** Where to place the upscaled result. Defaults to a new layer. */
  output?: 'new-layer' | 'replace-source' | 'non-destructive';
  /** Restoration quality policy — faithful preserves detail, balanced allows stronger reconstruction. */
  qualityPolicy?: 'faithful' | 'balanced';
}

/** Default bundled Real-ESRGAN model used by the shared worker path. */
export const DEFAULT_AI_UPSCALE_MODEL_ID = 'upscale-realesr-general';

const DEFAULT_MAX_PIXELS = 64_000_000;

function positiveDimension(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return Math.max(1, Math.round(value));
}

export function computeUpscaleDimensions(
  sourceWidth: number,
  sourceHeight: number,
  options: UpscaleOptions,
): { width: number; height: number } {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('Source dimensions must be positive');
  }

  const targetWidth = positiveDimension(options.targetWidth, 'targetWidth');
  const targetHeight = positiveDimension(options.targetHeight, 'targetHeight');
  let width: number;
  let height: number;

  if (targetWidth !== undefined || targetHeight !== undefined) {
    width =
      targetWidth ??
      Math.max(1, Math.round(((targetHeight as number) * sourceWidth) / sourceHeight));
    height =
      targetHeight ??
      Math.max(1, Math.round(((targetWidth as number) * sourceHeight) / sourceWidth));
  } else {
    const scale = options.scale ?? 2;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('scale must be positive');
    width = Math.max(1, Math.round(sourceWidth * scale));
    height = Math.max(1, Math.round(sourceHeight * scale));
  }

  const maxPixels = positiveDimension(
    options.maxPixels ?? DEFAULT_MAX_PIXELS,
    'maxPixels',
  ) as number;
  if (width * height > maxPixels) {
    throw new Error(`Output exceeds the maximum of ${maxPixels} pixels`);
  }
  return { width, height };
}

function nearest(source: ImageData, width: number, height: number): ImageData {
  const output = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / width));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const outputOffset = (y * width + x) * 4;
      output.data[outputOffset] = source.data[sourceOffset] as number;
      output.data[outputOffset + 1] = source.data[sourceOffset + 1] as number;
      output.data[outputOffset + 2] = source.data[sourceOffset + 2] as number;
      output.data[outputOffset + 3] = source.data[sourceOffset + 3] as number;
    }
  }
  return output;
}

function bilinear(source: ImageData, width: number, height: number): ImageData {
  const output = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const rawY = ((y + 0.5) * source.height) / height - 0.5;
    const sy = Math.max(0, Math.min(source.height - 1, rawY));
    const y0 = Math.floor(sy);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const rawX = ((x + 0.5) * source.width) / width - 0.5;
      const sx = Math.max(0, Math.min(source.width - 1, rawX));
      const x0 = Math.floor(sx);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sx - x0;
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const offsets = [
        (y0 * source.width + x0) * 4,
        (y0 * source.width + x1) * 4,
        (y1 * source.width + x0) * 4,
        (y1 * source.width + x1) * 4,
      ];
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sample = 0; sample < 4; sample += 1) {
        const offset = offsets[sample] as number;
        const weight = weights[sample] as number;
        const sampleAlpha = (source.data[offset + 3] as number) / 255;
        alpha += sampleAlpha * weight;
        red += (source.data[offset] as number) * sampleAlpha * weight;
        green += (source.data[offset + 1] as number) * sampleAlpha * weight;
        blue += (source.data[offset + 2] as number) * sampleAlpha * weight;
      }
      const outputOffset = (y * width + x) * 4;
      output.data[outputOffset] = alpha > 0 ? Math.round(red / alpha) : 0;
      output.data[outputOffset + 1] = alpha > 0 ? Math.round(green / alpha) : 0;
      output.data[outputOffset + 2] = alpha > 0 ? Math.round(blue / alpha) : 0;
      output.data[outputOffset + 3] = Math.round(alpha * 255);
    }
  }
  return output;
}

/**
 * Catmull-Rom bicubic interpolation kernel.
 * W(x) = 1.5|x|³ - 2.5|x|² + 1          for |x| ≤ 1
 *      = -0.5|x|³ + 2.5|x|² - 4|x| + 2  for |x| ≤ 2
 *      = 0                                otherwise
 */
function catmullRom(x: number): number {
  const ax = Math.abs(x);
  if (ax >= 2) return 0;
  if (ax >= 1) return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
  return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
}

/** Sample the pixel at (x, y) in premultiplied-alpha space. */
function samplePremultiplied(
  data: Uint8ClampedArray,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number, number, number] {
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const offset = (cy * stride + cx) * 4;
  const a = data[offset + 3] as number;
  return [
    (data[offset] as number) * a,
    (data[offset + 1] as number) * a,
    (data[offset + 2] as number) * a,
    a,
  ];
}

function bicubic(source: ImageData, width: number, height: number): ImageData {
  const output = new ImageData(width, height);
  const src = source.data;
  const sw = source.width;
  const sh = source.height;
  for (let y = 0; y < height; y += 1) {
    const sy = ((y + 0.5) * sh) / height - 0.5;
    const iy = Math.floor(sy);
    for (let x = 0; x < width; x += 1) {
      const sx = ((x + 0.5) * sw) / width - 0.5;
      const ix = Math.floor(sx);
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let dy = -1; dy <= 2; dy += 1) {
        const wy = catmullRom(sy - (iy + dy));
        if (wy === 0) continue;
        for (let dx = -1; dx <= 2; dx += 1) {
          const wx = catmullRom(sx - (ix + dx));
          if (wx === 0) continue;
          const weight = wx * wy;
          const [pr, pg, pb, pa] = samplePremultiplied(src, sw, ix + dx, iy + dy, sw, sh);
          alpha += pa * weight;
          red += pr * weight;
          green += pg * weight;
          blue += pb * weight;
        }
      }
      const outputOffset = (y * width + x) * 4;
      output.data[outputOffset] = alpha > 0 ? Math.round(red / alpha) : 0;
      output.data[outputOffset + 1] = alpha > 0 ? Math.round(green / alpha) : 0;
      output.data[outputOffset + 2] = alpha > 0 ? Math.round(blue / alpha) : 0;
      output.data[outputOffset + 3] = Math.round(alpha);
    }
  }
  return output;
}

/**
 * Lanczos-3 sinc-windowed interpolation kernel.
 * L(x) = sinc(πx) · sinc(πx/3)  for |x| < 3
 *      = 0                        otherwise
 */
function lanczos3Kernel(x: number): number {
  const ax = Math.abs(x);
  if (ax >= 3) return 0;
  if (ax < 1e-9) return 1;
  const pix = Math.PI * x;
  const pix3 = pix / 3;
  return (Math.sin(pix) / pix) * (Math.sin(pix3) / pix3);
}

function lanczos3(source: ImageData, width: number, height: number): ImageData {
  const output = new ImageData(width, height);
  const src = source.data;
  const sw = source.width;
  const sh = source.height;
  for (let y = 0; y < height; y += 1) {
    const sy = ((y + 0.5) * sh) / height - 0.5;
    const iy = Math.floor(sy);
    for (let x = 0; x < width; x += 1) {
      const sx = ((x + 0.5) * sw) / width - 0.5;
      const ix = Math.floor(sx);
      let totalWeight = 0;
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let dy = -2; dy <= 3; dy += 1) {
        const wy = lanczos3Kernel(sy - (iy + dy));
        if (wy === 0) continue;
        for (let dx = -2; dx <= 3; dx += 1) {
          const wx = lanczos3Kernel(sx - (ix + dx));
          if (wx === 0) continue;
          const weight = wx * wy;
          totalWeight += weight;
          const [pr, pg, pb, pa] = samplePremultiplied(src, sw, ix + dx, iy + dy, sw, sh);
          alpha += pa * weight;
          red += pr * weight;
          green += pg * weight;
          blue += pb * weight;
        }
      }
      const outputOffset = (y * width + x) * 4;
      const w = totalWeight || 1;
      output.data[outputOffset] = alpha > 0 ? Math.round(red / w / (alpha / w)) : 0;
      output.data[outputOffset + 1] = alpha > 0 ? Math.round(green / w / (alpha / w)) : 0;
      output.data[outputOffset + 2] = alpha > 0 ? Math.round(blue / w / (alpha / w)) : 0;
      output.data[outputOffset + 3] = Math.round(alpha / w);
    }
  }
  return output;
}

export function upscaleImageData(source: ImageData, options: UpscaleOptions = {}): ImageData {
  const { width, height } = computeUpscaleDimensions(source.width, source.height, options);
  switch (options.method) {
    case 'ai':
      throw new Error('AI upscaling is not available in the direct CPU path');
    case 'nearest':
      return nearest(source, width, height);
    case 'bicubic':
      return bicubic(source, width, height);
    case 'lanczos3':
      return lanczos3(source, width, height);
    default:
      return bilinear(source, width, height);
  }
}

/** A centred region of `source` at most `maxWidth`x`maxHeight`, copied 1:1. */
function centreCrop(source: ImageData, maxWidth: number, maxHeight: number): ImageData {
  const cropW = Math.max(1, Math.min(source.width, Math.round(maxWidth)));
  const cropH = Math.max(1, Math.min(source.height, Math.round(maxHeight)));
  if (cropW === source.width && cropH === source.height) return source;

  const originX = Math.floor((source.width - cropW) / 2);
  const originY = Math.floor((source.height - cropH) / 2);
  const out = new ImageData(cropW, cropH);
  for (let y = 0; y < cropH; y += 1) {
    const srcRow = (originY + y) * source.width;
    const dstRow = y * cropW;
    for (let x = 0; x < cropW; x += 1) {
      const srcOffset = (srcRow + originX + x) * 4;
      const dstOffset = (dstRow + x) * 4;
      out.data[dstOffset] = source.data[srcOffset] as number;
      out.data[dstOffset + 1] = source.data[srcOffset + 1] as number;
      out.data[dstOffset + 2] = source.data[srcOffset + 2] as number;
      out.data[dstOffset + 3] = source.data[srcOffset + 3] as number;
    }
  }
  return out;
}

/**
 * Compute a preview ImageData for upscale operations.
 *
 * Bounded work is achieved by upscaling a *crop* of the source at full
 * resolution, never by downsampling first. Downsampling ahead of the upscale
 * makes the preview a lossy round-trip that is strictly worse than the original
 * it is shown beside, so the comparison reads as "the upscale does nothing" (or
 * degrades the image) no matter how good the real output is.
 *
 * The crop is sized so the *result* lands near `previewMaxDimension`, keeping
 * cost roughly constant across scale factors. Callers display it beside the
 * matching region of the source.
 *
 * AI mode is handled by the worker/native provider instead.
 */
export function computeUpscalePreview(source: ImageData, options: UpscaleOptions = {}): ImageData {
  const maxDim = options.previewMaxDimension ?? 512;
  const isAi = options.method === 'ai';

  if (isAi) {
    // AI upscale will be handled by the worker/native provider; this is just
    // the CPU fallback path for preview when AI is unavailable.
    // In the full implementation, this function is only used for CPU modes.
    throw new Error('AI preview must use worker/native provider');
  }

  const scale = options.scale ?? 2;
  const cropLimit = Math.max(1, maxDim / Math.max(scale, 0.001));
  const previewSource = centreCrop(source, cropLimit, cropLimit);
  return upscaleImageData(previewSource, { ...options, scale });
}

/** Region of the source that {@link computeUpscalePreview} magnifies. */
export function upscalePreviewRegion(
  source: ImageData | { width: number; height: number },
  options: UpscaleOptions = {},
): { x: number; y: number; width: number; height: number } {
  const maxDim = options.previewMaxDimension ?? 512;
  const scale = options.scale ?? 2;
  const cropLimit = Math.max(1, maxDim / Math.max(scale, 0.001));
  const width = Math.max(1, Math.min(source.width, Math.round(cropLimit)));
  const height = Math.max(1, Math.min(source.height, Math.round(cropLimit)));
  return {
    x: Math.floor((source.width - width) / 2),
    y: Math.floor((source.height - height) / 2),
    width,
    height,
  };
}
