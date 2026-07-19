import { decontaminateMask, featherMaskArray } from './maskOps';
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
        rgbDist(r, g, b, data[seedIdx] ?? 0, data[seedIdx + 1] ?? 0, data[seedIdx + 2] ?? 0) <=
          tolerance;

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
      const dist = rgbDist(
        data[i] ?? 0,
        data[i + 1] ?? 0,
        data[i + 2] ?? 0,
        keyColor.r,
        keyColor.g,
        keyColor.b,
      );
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
      flattened.push({
        r: data[i] ?? 0,
        g: data[i + 1] ?? 0,
        b: data[i + 2] ?? 0,
        idx: y * width + x,
      });
    }
  }

  if (flattened.length === 0) return new Uint8Array(0);

  const nPixels = flattened.length;
  const border = flattened.filter(({ idx }) => {
    const x = idx % width;
    const y = Math.floor(idx / width);
    return x === 0 || y === 0 || x === width - 1 || y === height - 1;
  });
  const borderCount = Math.max(1, border.length);
  let c0 = border.reduce(
    (sum, pixel) => ({ r: sum.r + pixel.r, g: sum.g + pixel.g, b: sum.b + pixel.b }),
    { r: 0, g: 0, b: 0 },
  );
  c0 = { r: c0.r / borderCount, g: c0.g / borderCount, b: c0.b / borderCount };
  const farthest = flattened.reduce((best, pixel) =>
    rgbDist(pixel.r, pixel.g, pixel.b, c0.r, c0.g, c0.b) >
    rgbDist(best.r, best.g, best.b, c0.r, c0.g, c0.b)
      ? pixel
      : best,
  );
  let c1 = { r: farthest.r, g: farthest.g, b: farthest.b };

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
    const flat = flattened[i];
    if (flat === undefined) continue;
    mask[flat.idx] = (assignments[i] ?? 0) === fgCluster ? 255 : 0;
  }
  return mask;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

/** Segment a colour-consistent background by flooding inward from every image edge. */
export function adaptiveBorderMask(img: ImageData): Uint8Array {
  const { data, width, height } = img;
  const mask = new Uint8Array(width * height).fill(255);
  const borderIndices: number[] = [];
  for (let x = 0; x < width; x++) {
    borderIndices.push(x, (height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    borderIndices.push(y * width, y * width + width - 1);
  }
  const rs = borderIndices.map((i) => data[i * 4] ?? 0);
  const gs = borderIndices.map((i) => data[i * 4 + 1] ?? 0);
  const bs = borderIndices.map((i) => data[i * 4 + 2] ?? 0);
  const background = { r: median(rs), g: median(gs), b: median(bs) };
  const deviations = borderIndices.map((i) =>
    rgbDist(
      data[i * 4] ?? 0,
      data[i * 4 + 1] ?? 0,
      data[i * 4 + 2] ?? 0,
      background.r,
      background.g,
      background.b,
    ),
  );
  const tolerance = Math.min(72, Math.max(18, median(deviations) * 2.5 + 10));
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  for (const idx of borderIndices) {
    const i = idx * 4;
    if (
      (data[i + 3] ?? 0) < 128 ||
      rgbDist(
        data[i] ?? 0,
        data[i + 1] ?? 0,
        data[i + 2] ?? 0,
        background.r,
        background.g,
        background.b,
      ) <= tolerance
    ) {
      visited[idx] = 1;
      queue.push(idx);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head] ?? 0;
    mask[idx] = 0;
    const x = idx % width;
    const y = Math.floor(idx / width);
    const neighbours = [
      x > 0 ? idx - 1 : -1,
      x + 1 < width ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y + 1 < height ? idx + width : -1,
    ];
    for (const next of neighbours) {
      if (next < 0 || visited[next]) continue;
      visited[next] = 1;
      const ni = next * 4;
      const globallySimilar =
        rgbDist(
          data[ni] ?? 0,
          data[ni + 1] ?? 0,
          data[ni + 2] ?? 0,
          background.r,
          background.g,
          background.b,
        ) <=
        tolerance * 1.35;
      const locallySimilar =
        rgbDist(
          data[ni] ?? 0,
          data[ni + 1] ?? 0,
          data[ni + 2] ?? 0,
          data[idx * 4] ?? 0,
          data[idx * 4 + 1] ?? 0,
          data[idx * 4 + 2] ?? 0,
        ) <= Math.max(16, tolerance * 0.65);
      if ((data[ni + 3] ?? 0) < 128 || (globallySimilar && locallySimilar)) queue.push(next);
    }
  }
  return cleanupQuickMask(mask, width, height);
}

function cleanupQuickMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  if (width < 3 || height < 3) return mask;
  const cleaned = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let foreground = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((mask[(y + dy) * width + x + dx] ?? 0) >= 128) foreground++;
        }
      }
      if (foreground >= 7) cleaned[y * width + x] = 255;
      else if (foreground <= 2) cleaned[y * width + x] = 0;
    }
  }
  return cleaned;
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

function computeConfidence(
  mask: Uint8Array,
  width: number,
  height: number,
  image?: ImageData,
): number {
  let sum = 0;
  for (let i = 0; i < mask.length; i++) sum += mask[i] ?? 0;
  const avg = sum / mask.length / 255;
  const areaBalance = Math.min(1, Math.min(avg / 0.12, (1 - avg) / 0.12));
  let clearBorder = 0;
  let borderCount = 0;
  for (let x = 0; x < width; x++) {
    clearBorder += (mask[x] ?? 255) < 128 ? 1 : 0;
    clearBorder += (mask[(height - 1) * width + x] ?? 255) < 128 ? 1 : 0;
    borderCount += 2;
  }
  for (let y = 1; y < height - 1; y++) {
    clearBorder += (mask[y * width] ?? 255) < 128 ? 1 : 0;
    clearBorder += (mask[y * width + width - 1] ?? 255) < 128 ? 1 : 0;
    borderCount += 2;
  }
  const maskScore = areaBalance * 0.55 + (clearBorder / borderCount) * 0.45;
  if (!image) return Math.max(0.1, Math.min(1, maskScore));

  const borderPixels: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  for (let x = 0; x < width; x += step) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      borderPixels.push([image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]);
    }
  }
  for (let y = step; y < height - 1; y += step) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      borderPixels.push([image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]);
    }
  }
  const center = {
    r: median(borderPixels.map(([r]) => r)),
    g: median(borderPixels.map(([, g]) => g)),
    b: median(borderPixels.map(([, , b]) => b)),
  };
  const medianDeviation = median(
    borderPixels.map(([r, g, b]) => rgbDist(r, g, b, center.r, center.g, center.b)),
  );
  const backgroundConsistency = Math.exp(-medianDeviation / 28);
  return Math.max(0.1, Math.min(1, maskScore * (0.15 + backgroundConsistency * 0.85)));
}

function autoDetectMethod(
  _img: ImageData,
  clickPoint?: { x: number; y: number },
): { method: HeuristicMethod; params: Record<string, unknown> } {
  if (clickPoint) {
    return { method: 'floodFill', params: { tolerance: 30 } };
  }
  return { method: 'auto', params: {} };
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
      default: {
        const borderMask = adaptiveBorderMask(img);
        const clusteredMask = kMeansMask(img);
        mask =
          computeConfidence(borderMask, img.width, img.height) >=
          computeConfidence(clusteredMask, img.width, img.height)
            ? borderMask
            : clusteredMask;
      }
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

  if (opts.decontaminate) {
    mask = decontaminateMask(mask, img.width, img.height);
  }

  if (opts.feather && opts.feather > 0) {
    mask = featherMaskArray(mask, img.width, img.height, opts.feather);
  }

  const confidence = computeConfidence(mask, img.width, img.height, img);
  const maskDataUrl = maskToDataUrl(mask, img.width, img.height);
  const processingTimeMs = performance.now() - start;

  return {
    maskDataUrl,
    confidence,
    method: 'quick',
    processingTimeMs: Math.round(processingTimeMs),
    width: img.width,
    height: img.height,
    rawMask: mask,
  };
}
