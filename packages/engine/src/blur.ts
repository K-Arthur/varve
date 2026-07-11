import { linearToSrgb, srgbToLinear } from '@strata/shared';

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function premultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 255) continue;
    if (a === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    data[i] = clampByte((data[i]! * a) / 255);
    data[i + 1] = clampByte((data[i + 1]! * a) / 255);
    data[i + 2] = clampByte((data[i + 2]! * a) / 255);
  }
}

function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0 || a === 255) continue;
    const inv = 255 / a;
    data[i] = clampByte(data[i]! * inv);
    data[i + 1] = clampByte(data[i + 1]! * inv);
    data[i + 2] = clampByte(data[i + 2]! * inv);
  }
}

function clampEdge(x: number, size: number): number {
  return x < 0 ? 0 : x >= size ? size - 1 : x;
}

export function gaussianKernel(radius: number): number[] {
  if (radius === 0) return [1];
  const sigma = radius / 3;
  const size = 2 * radius + 1;
  const kernel = new Array<number>(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = v;
    sum += v;
  }
  const invSum = 1 / sum;
  for (let i = 0; i < size; i++) {
    kernel[i] = kernel[i]! * invSum;
  }
  return kernel;
}

export function boxBlurSeparable(data: ImageData, radius: number): ImageData {
  if (radius <= 0) return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const w = data.width;
  const h = data.height;
  const pixels = new Uint8ClampedArray(data.data);
  premultiply(pixels);
  const tmp = new Uint8ClampedArray(pixels.length);

  // Horizontal pass: sliding-window accumulator
  const diameter = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    let ar = 0;
    let ag = 0;
    let ab = 0;
    let aa = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = clampEdge(dx, w);
      const idx = (y * w + sx) * 4;
      ar += pixels[idx]!;
      ag += pixels[idx + 1]!;
      ab += pixels[idx + 2]!;
      aa += pixels[idx + 3]!;
    }
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      tmp[idx] = clampByte(ar / diameter);
      tmp[idx + 1] = clampByte(ag / diameter);
      tmp[idx + 2] = clampByte(ab / diameter);
      tmp[idx + 3] = clampByte(aa / diameter);

      // Slide window: subtract leftmost, add rightmost (+1)
      const leftX = x - radius;
      const rightX = x + radius + 1;
      const leftIdx = (y * w + clampEdge(leftX, w)) * 4;
      const rightIdx = (y * w + clampEdge(rightX, w)) * 4;
      ar -= pixels[leftIdx]!;
      ag -= pixels[leftIdx + 1]!;
      ab -= pixels[leftIdx + 2]!;
      aa -= pixels[leftIdx + 3]!;
      ar += pixels[rightIdx]!;
      ag += pixels[rightIdx + 1]!;
      ab += pixels[rightIdx + 2]!;
      aa += pixels[rightIdx + 3]!;
    }
  }

  // Vertical pass
  const out = new Uint8ClampedArray(pixels.length);
  for (let x = 0; x < w; x++) {
    let ar = 0;
    let ag = 0;
    let ab = 0;
    let aa = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const sy = clampEdge(dy, h);
      const idx = (sy * w + x) * 4;
      ar += tmp[idx]!;
      ag += tmp[idx + 1]!;
      ab += tmp[idx + 2]!;
      aa += tmp[idx + 3]!;
    }
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 4;
      out[idx] = clampByte(ar / diameter);
      out[idx + 1] = clampByte(ag / diameter);
      out[idx + 2] = clampByte(ab / diameter);
      out[idx + 3] = clampByte(aa / diameter);

      const topY = y - radius;
      const bottomY = y + radius + 1;
      const topIdx = (clampEdge(topY, h) * w + x) * 4;
      const bottomIdx = (clampEdge(bottomY, h) * w + x) * 4;
      ar -= tmp[topIdx]!;
      ag -= tmp[topIdx + 1]!;
      ab -= tmp[topIdx + 2]!;
      aa -= tmp[topIdx + 3]!;
      ar += tmp[bottomIdx]!;
      ag += tmp[bottomIdx + 1]!;
      ab += tmp[bottomIdx + 2]!;
      aa += tmp[bottomIdx + 3]!;
    }
  }

  unpremultiply(out);
  return new ImageData(out, w, h);
}

function convolve1D(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  kernel: number[],
  horizontal: boolean,
): void {
  const radius = (kernel.length - 1) / 2;
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sx = clampEdge(x + k - radius, w);
          const idx = (y * w + sx) * 4;
          const kw = kernel[k]!;
          r += src[idx]! * kw;
          g += src[idx + 1]! * kw;
          b += src[idx + 2]! * kw;
          a += src[idx + 3]! * kw;
        }
        const idx = (y * w + x) * 4;
        dst[idx] = clampByte(r);
        dst[idx + 1] = clampByte(g);
        dst[idx + 2] = clampByte(b);
        dst[idx + 3] = clampByte(a);
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sy = clampEdge(y + k - radius, h);
          const idx = (sy * w + x) * 4;
          const kw = kernel[k]!;
          r += src[idx]! * kw;
          g += src[idx + 1]! * kw;
          b += src[idx + 2]! * kw;
          a += src[idx + 3]! * kw;
        }
        const idx = (y * w + x) * 4;
        dst[idx] = clampByte(r);
        dst[idx + 1] = clampByte(g);
        dst[idx + 2] = clampByte(b);
        dst[idx + 3] = clampByte(a);
      }
    }
  }
}

export function gaussianBlurSeparable(data: ImageData, radius: number): ImageData {
  if (radius <= 0) return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const w = data.width;
  const h = data.height;

  if (radius > 100) {
    const factor = Math.min(Math.ceil(radius / 100), 4);
    const smallW = Math.max(1, Math.round(w / factor));
    const smallH = Math.max(1, Math.round(h / factor));
    const smallRadius = Math.max(1, Math.round(radius / factor));

    const smallData = downsample(data, smallW, smallH);
    const kernel = gaussianKernel(smallRadius);
    const smallPixels = new Uint8ClampedArray(smallData.data);
    premultiply(smallPixels);
    const tmp = new Uint8ClampedArray(smallPixels.length);
    convolve1D(smallPixels, tmp, smallW, smallH, kernel, true);
    convolve1D(tmp, smallPixels, smallW, smallH, kernel, false);
    unpremultiply(smallPixels);

    const smallResult = new ImageData(smallPixels, smallW, smallH);
    return upsample(smallResult, w, h);
  }

  const pixels = new Uint8ClampedArray(data.data);
  premultiply(pixels);
  const kernel = gaussianKernel(radius);
  const tmp = new Uint8ClampedArray(pixels.length);
  convolve1D(pixels, tmp, w, h, kernel, true);
  convolve1D(tmp, pixels, w, h, kernel, false);
  unpremultiply(pixels);
  return new ImageData(pixels, w, h);
}

export function gaussianBlurLinearLight(data: ImageData, radius: number): ImageData {
  if (radius <= 0) return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const pixels = new Uint8ClampedArray(data.data);

  // Convert to linear light: srgbToLinear on each RGB channel
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    pixels[i] = clampByte(srgbToLinear(r) * 255);
    pixels[i + 1] = clampByte(srgbToLinear(g) * 255);
    pixels[i + 2] = clampByte(srgbToLinear(b) * 255);
  }

  const linearData = new ImageData(pixels, data.width, data.height);
  const blurred = gaussianBlurSeparable(linearData, radius);

  // Convert back to sRGB
  const out = blurred.data;
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]! / 255;
    const g = out[i + 1]! / 255;
    const b = out[i + 2]! / 255;
    out[i] = clampByte(linearToSrgb(r));
    out[i + 1] = clampByte(linearToSrgb(g));
    out[i + 2] = clampByte(linearToSrgb(b));
  }

  return blurred;
}

function downsample(src: ImageData, dstW: number, dstH: number): ImageData {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const srcW = src.width;
  const srcH = src.height;
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = (x * srcW) / dstW;
      const sy = (y * srcH) / dstH;
      const ix = Math.min(Math.floor(sx), srcW - 1);
      const iy = Math.min(Math.floor(sy), srcH - 1);
      const srcIdx = (iy * srcW + ix) * 4;
      const dstIdx = (y * dstW + x) * 4;
      dst[dstIdx] = src.data[srcIdx]!;
      dst[dstIdx + 1] = src.data[srcIdx + 1]!;
      dst[dstIdx + 2] = src.data[srcIdx + 2]!;
      dst[dstIdx + 3] = src.data[srcIdx + 3]!;
    }
  }
  return new ImageData(dst, dstW, dstH);
}

function upsample(src: ImageData, dstW: number, dstH: number): ImageData {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const srcW = src.width;
  const srcH = src.height;
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = (x * srcW) / dstW;
      const sy = (y * srcH) / dstH;
      const ix = Math.min(Math.floor(sx), srcW - 1);
      const iy = Math.min(Math.floor(sy), srcH - 1);
      const srcIdx = (iy * srcW + ix) * 4;
      const dstIdx = (y * dstW + x) * 4;
      dst[dstIdx] = src.data[srcIdx]!;
      dst[dstIdx + 1] = src.data[srcIdx + 1]!;
      dst[dstIdx + 2] = src.data[srcIdx + 2]!;
      dst[dstIdx + 3] = src.data[srcIdx + 3]!;
    }
  }
  return new ImageData(dst, dstW, dstH);
}
