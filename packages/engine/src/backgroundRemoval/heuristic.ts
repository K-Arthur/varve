import type { BackgroundRemovalOptions, BackgroundRemovalResult, HeuristicMethod } from './types';

function rgbDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function colorAt(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
}

function grayAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4;
  return ((data[i] ?? 0) * 77 + (data[i + 1] ?? 0) * 150 + (data[i + 2] ?? 0) * 29) >> 8;
}

export function floodFillMask(
  img: ImageData,
  seed: { x: number; y: number },
  tolerance: number,
): Uint8Array {
  const { data, width, height } = img;
  const mask = new Uint8Array(width * height).fill(255);
  const sx = Math.round(seed.x);
  const sy = Math.round(seed.y);

  if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
    return mask;
  }

  const seedIdx = (sy * width + sx) * 4;
  const seedA = data[seedIdx + 3] ?? 0;
  const seedTransparent = seedA < 128;

  const stack: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];

  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;

    if (mask[idx] !== 255) continue;

    const [r, g, b, a] = colorAt(data, width, x, y);
    const isBg = seedTransparent
      ? a < 128
      : a >= 128 &&
        rgbDist(r, g, b, data[seedIdx] ?? 0, data[seedIdx + 1] ?? 0, data[seedIdx + 2] ?? 0) <= tolerance;

    if (!isBg) continue;
    mask[idx] = 0;
    stack.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 });
  }

  return mask;
}

export function chromaKeyMask(
  img: ImageData,
  keyColor: { r: number; g: number; b: number },
  tolerance: number,
): Uint8Array {
  const { data, width, height } = img;
  const mask = new Uint8Array(width * height).fill(255);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dist = rgbDist(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, keyColor.r, keyColor.g, keyColor.b);
      if (dist <= tolerance) {
        mask[y * width + x] = 0;
      }
    }
  }
  return mask;
}

export function kMeansMask(img: ImageData): Uint8Array {
  const { data, width, height } = img;

  const flattened: Array<{ r: number; g: number; b: number; idx: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      flattened.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0, idx: y * width + x });
    }
  }

  if (flattened.length === 0) return new Uint8Array(0);

  const nPixels = flattened.length;
  const sampled = new Set<number>();
  while (sampled.size < 2 && sampled.size < nPixels) {
    sampled.add(Math.floor(Math.random() * nPixels));
  }
  const sampleArr = [...sampled];
  let c0 = {
    r: flattened[sampleArr[0]!]!.r,
    g: flattened[sampleArr[0]!]!.g,
    b: flattened[sampleArr[0]!]!.b,
  };
  let c1 =
    sampleArr.length < 2
      ? { r: 255, g: 255, b: 255 }
      : {
          r: flattened[sampleArr[1]!]!.r,
          g: flattened[sampleArr[1]!]!.g,
          b: flattened[sampleArr[1]!]!.b,
        };

  const assignments = new Uint8Array(nPixels);
  for (let iter = 0; iter < 20; iter++) {
    let changed = 0;
    for (let i = 0; i < nPixels; i++) {
      const p = flattened[i];
      if (!p) continue;
      const d0 = rgbDist(p.r, p.g, p.b, c0.r, c0.g, c0.b);
      const d1 = rgbDist(p.r, p.g, p.b, c1.r, c1.g, c1.b);
      const newA = d0 < d1 ? 0 : 1;
      if (newA !== (assignments[i] ?? 0)) changed++;
      assignments[i] = newA;
    }
    if (changed === 0) break;

    let sumR0 = 0,
      sumG0 = 0,
      sumB0 = 0,
      count0 = 0;
    let sumR1 = 0,
      sumG1 = 0,
      sumB1 = 0,
      count1 = 0;
    for (let i = 0; i < nPixels; i++) {
      const p = flattened[i];
      if (!p) continue;
      if ((assignments[i] ?? 0) === 0) {
        sumR0 += p.r;
        sumG0 += p.g;
        sumB0 += p.b;
        count0++;
      } else {
        sumR1 += p.r;
        sumG1 += p.g;
        sumB1 += p.b;
        count1++;
      }
    }
    if (count0 > 0) c0 = { r: sumR0 / count0, g: sumG0 / count0, b: sumB0 / count0 };
    if (count1 > 0) c1 = { r: sumR1 / count1, g: sumG1 / count1, b: sumB1 / count1 };
  }

  const edgeScore = new Float64Array(2);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx = grayAt(data, width, x + 1, y) - grayAt(data, width, x - 1, y);
      const gy = grayAt(data, width, x, y + 1) - grayAt(data, width, x, y - 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag > 30) {
        const si = assignments[idx] ?? 0;
        edgeScore[si] = (edgeScore[si] ?? 0) + 1;
      }
    }
  }

  const fgCluster = (edgeScore[0] ?? 0) >= (edgeScore[1] ?? 0) ? 0 : 1;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < nPixels; i++) {
    mask[flattened[i]!.idx] = (assignments[i] ?? 0) === fgCluster ? 255 : 0;
  }
  return mask;
}

export function edgeDetectMask(img: ImageData): Uint8Array {
  const { data, width, height } = img;
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        grayAt(data, width, x - 1, y - 1) * -1 +
        grayAt(data, width, x - 1, y) * -2 +
        grayAt(data, width, x - 1, y + 1) * -1 +
        grayAt(data, width, x + 1, y - 1) * 1 +
        grayAt(data, width, x + 1, y) * 2 +
        grayAt(data, width, x + 1, y + 1) * 1;
      const gy =
        grayAt(data, width, x - 1, y - 1) * -1 +
        grayAt(data, width, x, y - 1) * -2 +
        grayAt(data, width, x + 1, y - 1) * -1 +
        grayAt(data, width, x - 1, y + 1) * 1 +
        grayAt(data, width, x, y + 1) * 2 +
        grayAt(data, width, x + 1, y + 1) * 1;
      const mag = Math.sqrt(gx * gx + gy * gy);
      edges[y * width + x] = mag > 50 ? 255 : 0;
    }
  }

  const mask = new Uint8Array(width * height).fill(255);
  const cornerPixels = [
    { x: 0, y: 0 },
    { x: Math.floor(width / 2), y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: Math.floor(height / 2) },
    { x: 0, y: height - 1 },
    { x: width - 1, y: Math.floor(height / 2) },
    { x: Math.floor(width / 2), y: height - 1 },
    { x: width - 1, y: height - 1 },
  ];

  const visited = new Uint8Array(width * height);
  const stack = [...cornerPixels];

  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if ((edges[idx] ?? 0) > 0) continue;
    mask[idx] = 0;
    stack.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 });
  }

  return mask;
}

function featherMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;

  const r = Math.max(1, Math.round(radius));
  const sigma = r / 2;
  const kernelSize = r * 2 + 1;
  const kernel = new Float64Array(kernelSize);
  let kernelSum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + r] = v;
    kernelSum += v;
  }
  for (let i = 0; i < kernelSize; i++) { const v = kernel[i] ?? 0; kernel[i] = v / kernelSum; }

  const temp = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        sum += (mask[y * width + sx] ?? 0) * (kernel[k + r] ?? 0);
      }
      temp[y * width + x] = Math.round(sum);
    }
  }

  const result = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        sum += (temp[sy * width + x] ?? 0) * (kernel[k + r] ?? 0);
      }
      result[y * width + x] = Math.round(sum);
    }
  }
  return result;
}

export function maskToDataUrl(mask: Uint8Array, width: number, height: number): string {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    for (let i = 0; i < mask.length; i++) {
      imageData.data[i * 4] = mask[i] ?? 0;
      imageData.data[i * 4 + 1] = mask[i] ?? 0;
      imageData.data[i * 4 + 2] = mask[i] ?? 0;
      imageData.data[i * 4 + 3] = mask[i] ?? 0;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }
  return 'data:image/png;base64,mask';
}

export function isBrowser(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function computeConfidence(mask: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < mask.length; i++) sum += mask[i] ?? 0;
  const avg = sum / mask.length / 255;
  const edgeBalance = Math.min(avg, 1 - avg) * 2;
  if (edgeBalance < 0.1) return 0.1;
  return Math.min(1, edgeBalance * 1.5);
}

function autoDetectMethod(
  img: ImageData,
  clickPoint?: { x: number; y: number },
): { method: HeuristicMethod; params: Record<string, unknown> } {
  const { data, width, height } = img;

  if (clickPoint) {
    return { method: 'floodFill', params: { tolerance: 30 } };
  }

  let hasTransparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) < 128) {
      hasTransparent = true;
      break;
    }
  }

  let colorSpread = 0;
  const sample = 100;
  for (let i = 0; i < sample; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const idx = (y * width + x) * 4;
    colorSpread += rgbDist(data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0, 128, 128, 128);
  }
  colorSpread /= sample;

  if (colorSpread < 30 && !hasTransparent) {
    return { method: 'kMeans', params: {} };
  }

  const cornerColors = new Set<string>();
  for (const [cx, cy] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ] as [number, number][]) {
    const idx = (cy * width + cx) * 4;
    cornerColors.add(`${data[idx] ?? 0},${data[idx + 1] ?? 0},${data[idx + 2] ?? 0}`);
  }

  if (cornerColors.size <= 2) {
    const idx = (0 * width + 0) * 4;
    return {
      method: 'chromaKey',
      params: { keyColor: { r: data[idx] ?? 0, g: data[idx + 1] ?? 0, b: data[idx + 2] ?? 0 }, tolerance: 40 },
    };
  }

  return { method: 'kMeans', params: {} };
}

export async function removeBackgroundHeuristic(
  img: ImageData,
  opts: BackgroundRemovalOptions,
): Promise<BackgroundRemovalResult> {
  const start = performance.now();

  if (img.width === 0 || img.height === 0) {
    throw new Error('Cannot remove background from empty image');
  }

  const heuristic = opts.heuristicMethod ?? 'auto';
  let mask: Uint8Array;

  if (heuristic === 'auto') {
    const detected = autoDetectMethod(img, opts.clickPoint);
    switch (detected.method) {
      case 'floodFill': {
        const params = detected.params as { tolerance: number };
        mask = floodFillMask(
          img,
          opts.clickPoint ?? { x: 0, y: 0 },
          opts.tolerance ?? params.tolerance ?? 30,
        );
        break;
      }
      case 'chromaKey': {
        const params = detected.params as {
          keyColor: { r: number; g: number; b: number };
          tolerance: number;
        };
        mask = chromaKeyMask(img, params.keyColor, opts.tolerance ?? params.tolerance ?? 40);
        break;
      }
      case 'kMeans': {
        mask = kMeansMask(img);
        break;
      }
      default:
        mask = kMeansMask(img);
    }
  } else {
    switch (heuristic) {
      case 'floodFill': {
        mask = floodFillMask(
          img,
          opts.clickPoint ?? { x: Math.floor(img.width / 2), y: Math.floor(img.height / 2) },
          opts.tolerance ?? 30,
        );
        break;
      }
      case 'chromaKey':
        mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, opts.tolerance ?? 40);
        break;
      case 'kMeans':
        mask = kMeansMask(img);
        break;
      case 'edgeDetect':
        mask = edgeDetectMask(img);
        break;
      default:
        mask = kMeansMask(img);
    }
  }

  if (opts.feather && opts.feather > 0) {
    mask = featherMask(mask, img.width, img.height, opts.feather);
  }

  const confidence = computeConfidence(mask);
  const maskDataUrl = maskToDataUrl(mask, img.width, img.height);
  const processingTimeMs = performance.now() - start;

  return {
    maskDataUrl,
    confidence,
    method: 'quick',
    processingTimeMs: Math.round(processingTimeMs),
    width: img.width,
    height: img.height,
  };
}
