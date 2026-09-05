import type { ImageTreatmentSpace } from '../imageTreatments';

/** Parameter guard for direct kernel calls as well as imported documents. */
export function bounded(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;
}

/** Convert an authored object-space vector into the captured raster's axes. */
export function rasterVector(x: number, y: number, space?: ImageTreatmentSpace): [number, number] {
  const matrix = space?.pixelToTreatment;
  if (matrix) {
    const [a, b, c, d] = matrix;
    const determinant = a * d - b * c;
    if (Number.isFinite(determinant) && Math.abs(determinant) > 1e-12) {
      return [(d * x - c * y) / determinant, (a * y - b * x) / determinant];
    }
  }
  const scale = bounded(space?.pixelsPerUnit, 0.001, 1024, 1);
  return [x * scale, y * scale];
}

/** Only nontransparent input can contribute to these local spatial kernels. */
export function occupiedBounds(image: ImageData): [number, number, number, number] | null {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!image.data[(y * image.width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : [left, top, right + 1, bottom + 1];
}
