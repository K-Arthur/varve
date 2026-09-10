/**
 * Lightweight block-matching optical flow for temporally consistent video matting.
 *
 * Pure typed-array implementation — safe to call from a Worker without
 * OffscreenCanvas/document access. Uses SAD (Sum of Absolute Differences)
 * on the luminance channel for block matching.
 *
 * Research basis: Lucas-Kanade pyramidal optical flow (simplified to single-scale
 * block matching); classic video matting temporal propagation (Chuang et al. 2002).
 */

export interface FlowVector {
  dx: number;
  dy: number;
  confidence: number;
}

function luminanceAt(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  x: number,
  y: number,
): number {
  const idx = (y * width + x) * 4;
  const r = data[idx] ?? 0;
  const g = data[idx + 1] ?? 0;
  const b = data[idx + 2] ?? 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function computeBlockSad(
  prev: Uint8ClampedArray | Uint8Array,
  curr: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  bx: number,
  by: number,
  blockSize: number,
  offsetX: number,
  offsetY: number,
): number {
  let sad = 0;
  for (let dy = 0; dy < blockSize; dy++) {
    for (let dx = 0; dx < blockSize; dx++) {
      const px = bx + dx;
      const py = by + dy;
      if (px >= width || py >= height) {
        sad += 255;
        continue;
      }
      const sx = bx + dx + offsetX;
      const sy = by + dy + offsetY;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        sad += 255;
        continue;
      }
      const vPrev = luminanceAt(prev, width, px, py);
      const vCurr = luminanceAt(curr, width, sx, sy);
      sad += Math.abs(vPrev - vCurr);
    }
  }
  return sad;
}

/**
 * Compute dense optical flow between two frames using block matching.
 *
 * Each block in the grid gets a single flow vector by searching for the best
 * matching block in the current frame within `searchRadius` pixels of the
 * previous frame's block position.
 */
export function computeBlockFlow(
  prev: Uint8ClampedArray | Uint8Array,
  curr: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  blockSize = 16,
  searchRadius = 8,
): FlowVector[][] {
  if (width === 0 || height === 0) return [];

  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);

  const flow: FlowVector[][] = [];

  for (let row = 0; row < rows; row++) {
    const flowRow: FlowVector[] = [];
    const by = row * blockSize;

    for (let col = 0; col < cols; col++) {
      const bx = col * blockSize;

      let bestDx = 0;
      let bestDy = 0;
      let bestSad = Infinity;
      const zeroSad = computeBlockSad(prev, curr, width, height, bx, by, blockSize, 0, 0);

      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const sad = computeBlockSad(prev, curr, width, height, bx, by, blockSize, dx, dy);
          if (sad < bestSad) {
            bestSad = sad;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      const bestConfidence = zeroSad > 0 ? Math.min(1, Math.max(0, 1 - bestSad / zeroSad)) : 1;

      flowRow.push({
        dx: bestSad < zeroSad ? bestDx : 0,
        dy: bestSad < zeroSad ? bestDy : 0,
        confidence: bestConfidence,
      });
    }
    flow.push(flowRow);
  }

  return flow;
}

/**
 * Warp a mask forward using the computed flow field.
 *
 * For each pixel, looks up the nearest block's flow vector and copies the
 * mask value from the source position (minus displacement) to the current
 * position. Bilinear interpolation of flow between neighboring blocks.
 */
export function warpMask(
  mask: Uint8Array,
  flow: FlowVector[][],
  srcWidth: number,
  srcHeight: number,
  blockSize: number,
): Uint8Array {
  if (flow.length === 0 || flow[0]!.length === 0) {
    return new Uint8Array(mask);
  }

  const result = new Uint8Array(mask.length);
  const cols = flow[0]!.length;
  const rows = flow.length;

  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < srcWidth; x++) {
      const bcol = Math.min(cols - 1, Math.floor(x / blockSize));
      const brow = Math.min(rows - 1, Math.floor(y / blockSize));

      const fv = flow[brow]![bcol]!;

      const sx = Math.round(x - fv.dx);
      const sy = Math.round(y - fv.dy);

      if (sx >= 0 && sx < srcWidth && sy >= 0 && sy < srcHeight) {
        result[y * srcWidth + x] = mask[sy * srcWidth + sx] ?? 0;
      } else {
        result[y * srcWidth + x] = 0;
      }
    }
  }

  return result;
}
