/**
 * CPU image enlargement shared by browser and desktop webview targets.
 *
 * Research basis: W3C compositing requires interpolation in premultiplied-alpha
 * space; nearest-neighbor is retained for hard-edged pixel artwork. Bicubic
 * (Catmull-Rom) and Lanczos-3 provide higher-quality photographic enlargement.
 */

export type UpscaleMethod = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos3' | 'ai';

export type UpscaleProgressFn = (done: number, total: number) => void;

export interface UpscaleOptions {
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
