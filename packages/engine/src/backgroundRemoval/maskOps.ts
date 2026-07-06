/**
 * Pure, DOM-free mask post-processing operations shared between the main
 * thread (heuristic.ts, index.ts) and the background removal Web Worker
 * (worker.ts). Kept dependency-free (typed arrays only, no canvas/document)
 * so the same code runs identically in a Worker global scope.
 *
 * Research basis: Photoshop "Select and Mask" Shift Edge (choke) + Feather;
 * GIMP Script-Fu edge-clean; classic image-matting edge refinement.
 */

/**
 * Reduces background-color spill/fringing at foreground edges by choking
 * (eroding) the semi-transparent halo band of a binary/soft mask.
 *
 * Fully opaque (>=245) and fully transparent (<=10) pixels are left
 * untouched — only the ambiguous "halo" band, where background color is
 * most likely to have bled into the edge, is tightened toward the nearest
 * darker (more transparent) neighbor via a 3x3 min filter. This shrinks the
 * foreground boundary by roughly one pixel, which is the same "choke"
 * technique used by traditional matting/keying tools to combat color spill
 * before compositing.
 */
export function decontaminateMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  if (width <= 0 || height <= 0 || mask.length === 0) return mask;

  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const v = mask[idx] ?? 0;
      if (v <= 10 || v >= 245) {
        result[idx] = v;
        continue;
      }
      let min = v;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nv = mask[ny * width + nx] ?? 0;
          if (nv < min) min = nv;
        }
      }
      result[idx] = min;
    }
  }
  return result;
}

/**
 * Separable Gaussian blur of a single-channel mask (0-255 per pixel).
 * Pure typed-array implementation — safe to call from a Worker without
 * OffscreenCanvas/document access.
 */
export function featherMaskArray(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0 || width <= 0 || height <= 0) return mask;

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
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] = (kernel[i] ?? 0) / kernelSum;
  }

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

/** Threshold raw sigmoid outputs to a binary 0/255 mask. */
export function thresholdMask(data: Float32Array, threshold = 0.5): Uint8Array {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    mask[i] = (data[i] ?? 0) > threshold ? 255 : 0;
  }
  return mask;
}

/** Nearest-neighbor upscale/downscale of a single-channel mask. */
export function resizeMaskNearestNeighbor(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return mask;

  const result = new Uint8Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = (dx * srcW) / dstW;
      const sy = (dy * srcH) / dstH;
      const ix = Math.min(Math.floor(sx), srcW - 1);
      const iy = Math.min(Math.floor(sy), srcH - 1);
      result[dy * dstW + dx] = mask[iy * srcW + ix] ?? 0;
    }
  }
  return result;
}

/** Pack RGBA ImageData into CHW float32 tensor data (0-1 range). */
export function packChwFloat32(imageData: {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): Float32Array {
  const { data, width, height } = imageData;
  const floatData = new Float32Array(width * height * 3);
  for (let i = 0; i < data.length / 4; i++) {
    floatData[i] = (data[i * 4] ?? 0) / 255;
    floatData[width * height + i] = (data[i * 4 + 1] ?? 0) / 255;
    floatData[width * height * 2 + i] = (data[i * 4 + 2] ?? 0) / 255;
  }
  return floatData;
}

/** Compute confidence from raw sigmoid outputs as mean distance from 0.5,
 * scaled to [0, 1]. Higher separation from the decision boundary = higher confidence.
 */
export function computeMaskConfidence(rawOutput: Float32Array): number {
  if (rawOutput.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rawOutput.length; i++) {
    sum += Math.abs((rawOutput[i] ?? 0) - 0.5);
  }
  return Math.min(1, (sum / rawOutput.length) * 2);
}

/** Bounding box of a connected mask component. */
export interface MaskComponentBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One foreground blob from connected-component labeling. */
export interface MaskComponent {
  id: number;
  pixelCount: number;
  bbox: MaskComponentBBox;
}

const FG_THRESHOLD = 128;

/**
 * 8-connected component labeling on a binary/soft mask.
 * Returns components sorted by pixel count descending.
 */
export function findConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  threshold = FG_THRESHOLD,
): MaskComponent[] {
  if (width <= 0 || height <= 0 || mask.length === 0) return [];

  const labels = new Int32Array(width * height);
  let nextId = 1;
  const components = new Map<
    number,
    { count: number; minX: number; minY: number; maxX: number; maxY: number }
  >();

  const idx = (x: number, y: number) => y * width + x;
  const neighbors8 = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ] as const;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if ((mask[i] ?? 0) < threshold || labels[i] !== 0) continue;

      const stack: number[] = [i];
      labels[i] = nextId;
      let count = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cy = Math.floor(cur / width);
        const cx = cur - cy * width;
        count++;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        for (const [dx, dy] of neighbors8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = idx(nx, ny);
          if ((mask[ni] ?? 0) < threshold || labels[ni] !== 0) continue;
          labels[ni] = nextId;
          stack.push(ni);
        }
      }

      components.set(nextId, {
        count,
        minX,
        minY,
        maxX,
        maxY,
      });
      nextId++;
    }
  }

  const result: MaskComponent[] = [];
  for (const [id, c] of components) {
    result.push({
      id,
      pixelCount: c.count,
      bbox: {
        x: c.minX,
        y: c.minY,
        w: c.maxX - c.minX + 1,
        h: c.maxY - c.minY + 1,
      },
    });
  }
  result.sort((a, b) => b.pixelCount - a.pixelCount);
  return result;
}

/** Keep only pixels belonging to the given component ids (8-connected labels). */
export function filterMaskByComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  keepIds: ReadonlySet<number>,
  threshold = FG_THRESHOLD,
): Uint8Array {
  if (keepIds.size === 0) return new Uint8Array(mask.length);

  const labels = new Int32Array(width * height);
  let nextId = 1;
  const idx = (x: number, y: number) => y * width + x;
  const neighbors8 = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ] as const;

  const labelToKeep = new Map<number, boolean>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if ((mask[i] ?? 0) < threshold || labels[i] !== 0) continue;

      const stack: number[] = [i];
      labels[i] = nextId;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cy = Math.floor(cur / width);
        const cx = cur - cy * width;
        for (const [dx, dy] of neighbors8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = idx(nx, ny);
          if ((mask[ni] ?? 0) < threshold || labels[ni] !== 0) continue;
          labels[ni] = nextId;
          stack.push(ni);
        }
      }
      labelToKeep.set(nextId, keepIds.has(nextId));
      nextId++;
    }
  }

  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const label = labels[i] ?? 0;
    if (label > 0 && labelToKeep.get(label)) {
      result[i] = mask[i] ?? 0;
    }
  }
  return result;
}

/** Extract single-channel mask from RGBA ImageData (red channel; our mask PNGs store value in RGB). */
export function maskFromImageData(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = data[i * 4] ?? 0;
  }
  return mask;
}

/** Pack single-channel mask into RGBA ImageData for data URL encoding. */
export function maskToImageData(mask: Uint8Array, width: number, height: number): ImageData {
  const imageData = new ImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    imageData.data[i * 4] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = 255;
  }
  return imageData;
}
