/**
 * Pure, DOM-free mask post-processing operations shared between the main
 * thread (heuristic.ts, index.ts) and the background removal Web Worker
 * (worker.ts). Kept dependency-free (typed arrays only, no canvas/document)
 * so the same code runs identically in a Worker global scope.
 *
 * Research basis: Photoshop "Select and Mask" Shift Edge (choke) + Feather;
 * GIMP Script-Fu edge-clean; classic image-matting edge refinement; rembg
 * U2-Net/BiRefNet normalization and mask post-processing.
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

/**
 * Convert U2-Net probabilities or BiRefNet logits to a rembg-faithful soft
 * mask byte array: optional sigmoid (BiRefNet exports omit it from the
 * graph), then clamp to [0, 1] and scale to 0-255.
 *
 * Deliberately NOT a min-max stretch: stretching is input-dependent and
 * inflates semi-transparent edge values (measured up to ~0.065 mask MAE
 * divergence from the reference on the benchmark corpus). Clamping is
 * monotone, so thresholded binary metrics are unchanged, while soft edge
 * alpha now matches the reference implementation.
 */
export function normalizeSegmentationOutput(data: Float32Array, applySigmoid: boolean): Uint8Array {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const raw = data[i] ?? 0;
    const probability = applySigmoid ? 1 / (1 + Math.exp(-raw)) : raw;
    mask[i] = Math.round(Math.min(1, Math.max(0, probability)) * 255);
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

/** Bilinear resize for a soft single-channel mask using pixel-center coordinates. */
export function resizeMaskBilinear(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return mask;
  const result = new Uint8Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.max(0, Math.min(srcH - 1, ((dy + 0.5) * srcH) / dstH - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const wy = sy - y0;
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.max(0, Math.min(srcW - 1, ((dx + 0.5) * srcW) / dstW - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const wx = sx - x0;
      const top = (mask[y0 * srcW + x0] ?? 0) * (1 - wx) + (mask[y0 * srcW + x1] ?? 0) * wx;
      const bottom = (mask[y1 * srcW + x0] ?? 0) * (1 - wx) + (mask[y1 * srcW + x1] ?? 0) * wx;
      result[dy * dstW + dx] = Math.round(top * (1 - wy) + bottom * wy);
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

/** Pack an RGBA image using rembg's max-value and ImageNet normalization. */
export function packSegmentationChwFloat32(imageData: {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): Float32Array {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  let maxChannel = 0;
  for (let i = 0; i < pixelCount; i++) {
    maxChannel = Math.max(maxChannel, data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0);
  }
  const divisor = Math.max(maxChannel, 1e-6);
  const mean = [0.485, 0.456, 0.406] as const;
  const std = [0.229, 0.224, 0.225] as const;
  const result = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = (data[i * 4 + channel] ?? 0) / divisor;
      result[channel * pixelCount + i] = (value - (mean[channel] ?? 0)) / (std[channel] ?? 1);
    }
  }
  return result;
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
  /** Mean mask intensity within this component (0–1 scale). */
  confidence: number;
  /** Fraction of total image pixels this component occupies. */
  relativeArea: number;
  /** Centroid of foreground pixels in mask-pixel coordinates. */
  centerOfMass: { x: number; y: number };
  /** Number of foreground pixels adjacent to at least one background pixel. */
  edgePixelCount: number;
  /** True if this is the largest component by pixel count. */
  isLargest: boolean;
  /** If this component was formed by merging smaller components, their original IDs. */
  mergedFrom?: number[];
}

const FG_THRESHOLD = 128;

interface ComponentAccumulator {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  sumMaskValue: number;
  edgeCount: number;
}

/**
 * 8-connected component labeling on a binary/soft mask.
 * Returns components sorted by pixel count descending with stable IDs
 * assigned by spatial position (top-to-bottom, left-to-right reading order).
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
  const components = new Map<number, ComponentAccumulator>();

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
      let sumX = 0;
      let sumY = 0;
      let sumMaskValue = 0;
      let edgeCount = 0;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cy = Math.floor(cur / width);
        const cx = cur - cy * width;
        const mv = mask[cur] ?? 0;
        count++;
        sumX += cx;
        sumY += cy;
        sumMaskValue += mv;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        // Check if this pixel is an edge pixel (has at least one background neighbor)
        let isEdge = false;
        for (const [dx, dy] of neighbors8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            isEdge = true;
            break;
          }
          const ni = idx(nx, ny);
          if ((mask[ni] ?? 0) < threshold) {
            isEdge = true;
            break;
          }
        }
        if (isEdge) edgeCount++;

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
        sumX,
        sumY,
        sumMaskValue,
        edgeCount,
      });
      nextId++;
    }
  }

  const totalPixels = width * height;
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
      confidence: c.count > 0 ? c.sumMaskValue / (c.count * 255) : 0,
      relativeArea: totalPixels > 0 ? c.count / totalPixels : 0,
      centerOfMass: {
        x: c.count > 0 ? c.sumX / c.count : c.minX,
        y: c.count > 0 ? c.sumY / c.count : c.minY,
      },
      edgePixelCount: c.edgeCount,
      isLargest: false,
    });
  }
  result.sort((a, b) => b.pixelCount - a.pixelCount);
  if (result.length > 0 && result[0]) {
    result[0].isLargest = true;
  }
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

/**
 * Merge components whose bounding boxes are close together or overlap.
 * Returns a new component list with merged entries. Merged components
 * record their original IDs in `mergedFrom` for transparency.
 */
export function mergeNearbyComponents(
  components: MaskComponent[],
  _mask: Uint8Array,
  width: number,
  height: number,
): MaskComponent[] {
  if (components.length <= 1) return [...components];

  const gapThreshold = Math.max(10, 0.02 * Math.max(width, height));
  const maxCombinedAreaRatio = 0.8;
  const totalPixels = width * height;

  // Build adjacency: merge pairs whose bboxes are within gapThreshold
  const merged = new Set<number>();
  const result: MaskComponent[] = [];

  for (let i = 0; i < components.length; i++) {
    const ci = components[i]!;
    if (merged.has(ci.id)) continue;

    let current = { ...ci, mergedFrom: ci.mergedFrom ? [...ci.mergedFrom] : [] };

    for (let j = i + 1; j < components.length; j++) {
      const cj = components[j]!;
      if (merged.has(cj.id)) continue;

      // Compute gap between bounding boxes (0 if overlapping)
      const gapX = Math.max(
        0,
        Math.max(
          current.bbox.x - (cj.bbox.x + cj.bbox.w),
          cj.bbox.x - (current.bbox.x + current.bbox.w),
        ),
      );
      const gapY = Math.max(
        0,
        Math.max(
          current.bbox.y - (cj.bbox.y + cj.bbox.h),
          cj.bbox.y - (current.bbox.y + current.bbox.h),
        ),
      );
      const gap = Math.sqrt(gapX * gapX + gapY * gapY);

      // Centroid distance
      const dx = current.centerOfMass.x - cj.centerOfMass.x;
      const dy = current.centerOfMass.y - cj.centerOfMass.y;
      const centroidDist = Math.sqrt(dx * dx + dy * dy);

      // Max diagonal of either bbox
      const diag1 = Math.sqrt(current.bbox.w * current.bbox.w + current.bbox.h * current.bbox.h);
      const diag2 = Math.sqrt(cj.bbox.w * cj.bbox.w + cj.bbox.h * cj.bbox.h);
      const maxDiag = Math.max(diag1, diag2);

      const shouldMerge = gap <= gapThreshold && centroidDist <= 3 * maxDiag;

      // Guard: don't merge if combined area would exceed 80% of image
      const combinedRatio = (current.pixelCount + cj.pixelCount) / totalPixels;
      if (shouldMerge && combinedRatio <= maxCombinedAreaRatio) {
        // Merge cj into current
        const newMinX = Math.min(current.bbox.x, cj.bbox.x);
        const newMinY = Math.min(current.bbox.y, cj.bbox.y);
        const newMaxX = Math.max(current.bbox.x + current.bbox.w, cj.bbox.x + cj.bbox.w);
        const newMaxY = Math.max(current.bbox.y + current.bbox.h, cj.bbox.y + cj.bbox.h);
        const newCount = current.pixelCount + cj.pixelCount;
        const newX =
          (current.centerOfMass.x * current.pixelCount + cj.centerOfMass.x * cj.pixelCount) /
          newCount;
        const newY =
          (current.centerOfMass.y * current.pixelCount + cj.centerOfMass.y * cj.pixelCount) /
          newCount;

        current = {
          ...current,
          pixelCount: newCount,
          bbox: { x: newMinX, y: newMinY, w: newMaxX - newMinX, h: newMaxY - newMinY },
          confidence:
            (current.confidence * current.pixelCount + cj.confidence * cj.pixelCount) / newCount,
          relativeArea: newCount / totalPixels,
          centerOfMass: { x: newX, y: newY },
          edgePixelCount: current.edgePixelCount + cj.edgePixelCount,
          mergedFrom: [...(current.mergedFrom ?? []), cj.id, ...(cj.mergedFrom ?? [])],
        };
        merged.add(cj.id);
      }
    }

    result.push(current);
  }

  // Re-sort by pixel count descending and reassign spatially-stable IDs
  result.sort((a, b) => b.pixelCount - a.pixelCount);
  return assignStableIds(result);
}

/**
 * Assign stable IDs based on spatial position (top-to-bottom, left-to-right reading order).
 * This ensures "Subject 1" is always the top-left-most subject regardless of flood-fill order.
 */
export function assignStableIds(components: MaskComponent[]): MaskComponent[] {
  const sorted = [...components].sort((a, b) => {
    // Primary: top-to-bottom (centerOfMass.y)
    const yDiff = a.centerOfMass.y - b.centerOfMass.y;
    if (Math.abs(yDiff) > 5) return yDiff;
    // Secondary: left-to-right (centerOfMass.x)
    return a.centerOfMass.x - b.centerOfMass.x;
  });

  return sorted.map((c, i) => ({
    ...c,
    id: i + 1,
    isLargest: i === 0,
  }));
}

/**
 * Extract a single-component mask where only the given component's pixels
 * retain their original values (all other pixels zeroed). Useful for
 * generating per-component thumbnails in the frontend.
 */
export function extractComponentMask(
  mask: Uint8Array,
  width: number,
  height: number,
  componentId: number,
  threshold = FG_THRESHOLD,
): Uint8Array {
  return filterMaskByComponents(mask, width, height, new Set([componentId]), threshold);
}

/**
 * Compute a union mask of all given components. Each pixel retains the
 * maximum value across all selected component masks.
 */
export function unionComponentMasks(
  mask: Uint8Array,
  width: number,
  height: number,
  componentIds: ReadonlySet<number>,
  threshold = FG_THRESHOLD,
): Uint8Array {
  return filterMaskByComponents(mask, width, height, componentIds, threshold);
}

/**
 * Fill small holes in a soft mask by flooding background regions that are
 * fully enclosed by foreground pixels.
 *
 * A "hole" is a connected background region whose area is below the threshold
 * and that has no border-touching background pixels. This removes specular
 * highlights, small gaps in hair/feather masks, and sensor-noise dropout
 * without affecting the overall silhouette.
 */
export function fillMaskHoles(
  mask: Uint8Array,
  width: number,
  height: number,
  maxHoleArea = 64,
  foregroundThreshold = 128,
): Uint8Array {
  if (width <= 0 || height <= 0) return mask;

  const result = new Uint8Array(mask);
  const visited = new Uint8Array(width * height);
  const idx = (x: number, y: number) => y * width + x;
  const n4: [number, number][] = [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if (visited[i]! || result[i]! >= foregroundThreshold) continue;

      // Flood-fill background region.
      const stack: number[] = [i];
      visited[i] = 1;
      const pixels: number[] = [];
      let touchesBorder = false;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        pixels.push(cur);
        const cy = Math.floor(cur / width);
        const cx = cur - cy * width;

        if (cx === 0 || cx === width - 1 || cy === 0 || cy === height - 1) {
          touchesBorder = true;
        }

        for (const [dx, dy] of n4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = idx(nx, ny);
          if (visited[ni]! || result[ni]! >= foregroundThreshold) continue;
          visited[ni] = 1;
          if (pixels.length < maxHoleArea + 1) {
            stack.push(ni);
          }
        }

        // Early exit: once we exceed maxHoleArea or hit border, stop collecting.
        if (pixels.length > maxHoleArea || touchesBorder) break;
      }

      // If the region is small and fully enclosed, fill it.
      if (pixels.length > 0 && pixels.length <= maxHoleArea && !touchesBorder) {
        for (const pi of pixels) {
          result[pi] = 255;
        }
      }
    }
  }

  return result;
}

/**
 * Expand (dilate) a soft mask — grows the foreground region outward.
 * Uses a separable approximation for efficiency: horizontal pass then vertical pass.
 */
export function expandMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  _threshold = 128,
): Uint8Array {
  if (radius <= 0 || width <= 0 || height <= 0) return mask;

  const temp = new Uint8Array(mask.length);
  const r = Math.min(radius, Math.max(width, height));

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = mask[y * width + x] ?? 0;
      for (let dx = -r; dx <= r; dx++) {
        const sx = Math.min(width - 1, Math.max(0, x + dx));
        const v = mask[y * width + sx] ?? 0;
        if (v > maxVal) maxVal = v;
      }
      temp[y * width + x] = maxVal;
    }
  }

  // Vertical pass
  const result = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let maxVal = temp[y * width + x] ?? 0;
      for (let dy = -r; dy <= r; dy++) {
        const sy = Math.min(height - 1, Math.max(0, y + dy));
        const v = temp[sy * width + x] ?? 0;
        if (v > maxVal) maxVal = v;
      }
      result[y * width + x] = maxVal;
    }
  }

  return result;
}

/**
 * Contract (erode) a soft mask — shrinks the foreground region inward.
 * Uses separable min filter: horizontal pass then vertical pass.
 */
export function contractMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0 || width <= 0 || height <= 0) return mask;

  const temp = new Uint8Array(mask.length);
  const r = Math.min(radius, Math.max(width, height));

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = mask[y * width + x] ?? 0;
      for (let dx = -r; dx <= r; dx++) {
        const sx = Math.min(width - 1, Math.max(0, x + dx));
        const v = mask[y * width + sx] ?? 0;
        if (v < minVal) minVal = v;
      }
      temp[y * width + x] = minVal;
    }
  }

  // Vertical pass
  const result = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minVal = temp[y * width + x] ?? 0;
      for (let dy = -r; dy <= r; dy++) {
        const sy = Math.min(height - 1, Math.max(0, y + dy));
        const v = temp[sy * width + x] ?? 0;
        if (v < minVal) minVal = v;
      }
      result[y * width + x] = minVal;
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
