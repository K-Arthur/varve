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
