// @ts-nocheck
// Low-level byte loops over bounds-checked image data; noUncheckedIndexedAccess
// produces noise here without adding safety.
type FixedByteArray = { [i: number]: number };

export function computePsnr(original: ImageData, processed: ImageData): number | null {
  if (original.width !== processed.width || original.height !== processed.height) {
    return null;
  }
  const len = original.data.length;
  const originalData = original.data as unknown as FixedByteArray;
  const processedData = processed.data as unknown as FixedByteArray;
  let mse = 0;
  for (let i = 0; i < len; i++) {
    const diff = originalData[i] - processedData[i];
    mse += diff * diff;
  }
  mse /= len / 4;
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}

export function computeSsim(original: ImageData, processed: ImageData): number | null {
  if (original.width !== processed.width || original.height !== processed.height) {
    return null;
  }

  const K1 = 0.01;
  const K2 = 0.03;
  const L = 255;
  const c1 = (K1 * L) ** 2;
  const c2 = (K2 * L) ** 2;
  const originalData = original.data as unknown as FixedByteArray;
  const processedData = processed.data as unknown as FixedByteArray;

  const w = Math.min(original.width, 256);
  const h = Math.min(original.height, 256);

  let totalSsim = 0;
  let windows = 0;

  const windowSize = 8;
  for (let y = 0; y + windowSize <= h; y += windowSize) {
    for (let x = 0; x + windowSize <= w; x += windowSize) {
      let sumX = 0,
        sumY = 0,
        sumXy = 0,
        sumX2 = 0,
        sumY2 = 0;
      const pixels = windowSize * windowSize;
      for (let dy = 0; dy < windowSize; dy++) {
        for (let dx = 0; dx < windowSize; dx++) {
          const i = ((y + dy) * original.width + (x + dx)) * 4;
          const xi = originalData[i] / L;
          const yi = processedData[i] / L;
          sumX += xi;
          sumY += yi;
          sumX2 += xi * xi;
          sumY2 += yi * yi;
          sumXy += xi * yi;
        }
      }
      const ux = sumX / pixels;
      const uy = sumY / pixels;
      const vx = sumX2 / pixels - ux * ux;
      const vy = sumY2 / pixels - uy * uy;
      const cxy = sumXy / pixels - ux * uy;
      const ssim =
        ((2 * ux * uy + c1) * (2 * cxy + c2)) / ((ux * ux + uy * uy + c1) * (vx + vy + c2));
      totalSsim += ssim;
      windows++;
    }
  }

  return windows > 0 ? totalSsim / windows : null;
}

export function computeMultiScaleSsim(original: ImageData, processed: ImageData): number | null {
  if (original.width !== processed.width || original.height !== processed.height) {
    return null;
  }
  const ssim = computeSsim(original, processed);
  if (ssim === null) return null;

  let current = ssim;
  let oSrc = original;
  let pSrc = processed;

  for (let scale = 2; scale <= 5; scale++) {
    const ow = Math.max(1, Math.floor(oSrc.width / 2));
    const oh = Math.max(1, Math.floor(oSrc.height / 2));
    const oDown = downscaleHalf(oSrc, ow, oh);
    const pDown = downscaleHalf(pSrc, ow, oh);
    const s = computeSsim(oDown, pDown);
    if (s !== null) {
      current = current * 0.6 + s * 0.4;
    }
    oSrc = oDown;
    pSrc = pDown;
  }

  return current;
}

function downscaleHalf(source: ImageData, outW: number, outH: number): ImageData {
  const out = new ImageData(outW, outH);
  const sourceData = source.data as unknown as FixedByteArray;
  const outData = out.data as unknown as FixedByteArray;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const srcX = Math.min(Math.floor((x * source.width) / outW), source.width - 2);
      const srcY = Math.min(Math.floor((y * source.height) / outH), source.height - 2);
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((srcY + dy) * source.width + (srcX + dx)) * 4;
          r += sourceData[i];
          g += sourceData[i + 1];
          b += sourceData[i + 2];
          a += sourceData[i + 3];
        }
      }
      const di = (y * outW + x) * 4;
      outData[di] = Math.round(r / 4);
      outData[di + 1] = Math.round(g / 4);
      outData[di + 2] = Math.round(b / 4);
      outData[di + 3] = Math.round(a / 4);
    }
  }
  return out;
}

export function computeColorDifference(original: ImageData, processed: ImageData): number | null {
  if (original.width !== processed.width || original.height !== processed.height) {
    return null;
  }
  const len = original.data.length / 4;
  const originalData = original.data as unknown as FixedByteArray;
  const processedData = processed.data as unknown as FixedByteArray;
  let totalDiff = 0;
  for (let i = 0; i < len; i++) {
    const io = i * 4;
    const dr = Math.abs(originalData[io] - processedData[io]);
    const dg = Math.abs(originalData[io + 1] - processedData[io + 1]);
    const db = Math.abs(originalData[io + 2] - processedData[io + 2]);
    totalDiff += (dr + dg + db) / 3;
  }
  return totalDiff / len;
}

export function computeAlphaDifference(original: ImageData, processed: ImageData): number | null {
  if (original.width !== processed.width || original.height !== processed.height) {
    return null;
  }
  const len = original.data.length / 4;
  const originalData = original.data as unknown as FixedByteArray;
  const processedData = processed.data as unknown as FixedByteArray;
  let totalDiff = 0;
  for (let i = 0; i < len; i++) {
    totalDiff += Math.abs(originalData[i * 4 + 3] - processedData[i * 4 + 3]);
  }
  return totalDiff / len;
}

export function computeTileBoundaryDifference(image: ImageData, tileSize: number): number {
  const w = image.width;
  const h = image.height;
  const imageData = image.data as unknown as FixedByteArray;
  let totalDiff = 0;
  let samples = 0;

  for (let y = 0; y < h; y++) {
    for (let tx = tileSize; tx < w; tx += tileSize) {
      const leftIdx = (y * w + tx - 1) * 4;
      const rightIdx = (y * w + tx) * 4;
      const dr = Math.abs(imageData[leftIdx] - imageData[rightIdx]);
      const dg = Math.abs(imageData[leftIdx + 1] - imageData[rightIdx + 1]);
      const db = Math.abs(imageData[leftIdx + 2] - imageData[rightIdx + 2]);
      totalDiff += (dr + dg + db) / 3;
      samples++;
    }
  }

  for (let x = 0; x < w; x++) {
    for (let ty = tileSize; ty < h; ty += tileSize) {
      const topIdx = ((ty - 1) * w + x) * 4;
      const bottomIdx = (ty * w + x) * 4;
      const dr = Math.abs(imageData[topIdx] - imageData[bottomIdx]);
      const dg = Math.abs(imageData[topIdx + 1] - imageData[bottomIdx + 1]);
      const db = Math.abs(imageData[topIdx + 2] - imageData[bottomIdx + 2]);
      totalDiff += (dr + dg + db) / 3;
      samples++;
    }
  }

  return samples > 0 ? totalDiff / samples : 0;
}

export function hasNanPixels(image: ImageData): boolean {
  const imageData = image.data as unknown as FixedByteArray;
  for (let i = 0; i < image.data.length; i++) {
    if (Number.isNaN(imageData[i])) return true;
  }
  return false;
}

export function extractRegion(
  image: ImageData,
  region: { x: number; y: number; width: number; height: number },
): ImageData {
  const { x, y, width, height } = region;
  const out = new ImageData(width, height);
  const imageData = image.data as unknown as FixedByteArray;
  const outData = out.data as unknown as FixedByteArray;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const srcX = Math.min(x + dx, image.width - 1);
      const srcY = Math.min(y + dy, image.height - 1);
      const srcIdx = (srcY * image.width + srcX) * 4;
      const dstIdx = (dy * width + dx) * 4;
      for (let c = 0; c < 4; c++) {
        outData[dstIdx + c] = imageData[srcIdx + c];
      }
    }
  }
  return out;
}

export function computePalettePreservation(original: ImageData, processed: ImageData): boolean {
  const origColors = new Set<string>();
  const len = original.data.length / 4;
  const originalData = original.data as unknown as FixedByteArray;
  const processedData = processed.data as unknown as FixedByteArray;
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    const key = `${originalData[idx]},${originalData[idx + 1]},${originalData[idx + 2]},${originalData[idx + 3]}`;
    origColors.add(key);
  }
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    const key = `${processedData[idx]},${processedData[idx + 1]},${processedData[idx + 2]},${processedData[idx + 3]}`;
    if (!origColors.has(key)) return false;
  }
  return true;
}
