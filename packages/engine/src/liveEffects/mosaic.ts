import type { ImageTreatmentSpace } from '../imageTreatments';
import { bounded, occupiedBounds, rasterVector } from './spatialSampling';

export interface MosaicParams {
  blockSize: number;
  originX: number;
  originY: number;
}

/**
 * Box-average mosaic in a stable object-coordinate grid. Accumulation uses
 * premultiplied encoded sRGB and averages coverage, including transparent pixels.
 * A rotated camera rotates the grid with the object. This is editable styling,
 * never secure redaction. At capture edges only available samples are averaged.
 */
export function applyMosaic(
  image: ImageData,
  params: MosaicParams,
  space?: ImageTreatmentSpace,
): ImageData {
  const bounds = occupiedBounds(image);
  if (!bounds) return image;
  const block = bounded(params.blockSize, 2, 128, 12);
  const originX = bounded(params.originX, -128, 128, 0);
  const originY = bounded(params.originY, -128, 128, 0);
  const scale = bounded(space?.pixelsPerUnit, 0.001, 1024, 1);
  const [a, b, c, d, e, f] = space?.pixelToTreatment ?? [1 / scale, 0, 0, 1 / scale, 0, 0];
  const vx = rasterVector(block, 0, space);
  const vy = rasterVector(0, block, space);
  const padX = Math.ceil(Math.abs(vx[0]) + Math.abs(vy[0]));
  const padY = Math.ceil(Math.abs(vx[1]) + Math.abs(vy[1]));
  const left = Math.max(0, bounds[0] - padX);
  const top = Math.max(0, bounds[1] - padY);
  const right = Math.min(image.width, bounds[2] + padX);
  const bottom = Math.min(image.height, bounds[3] + padY);
  const cellX = (x: number, y: number) =>
    Math.floor((a * (x + 0.5) + c * (y + 0.5) + e - originX) / block);
  const cellY = (x: number, y: number) =>
    Math.floor((b * (x + 0.5) + d * (y + 0.5) + f - originY) / block);
  const xs = [
    cellX(left, top),
    cellX(right - 1, top),
    cellX(left, bottom - 1),
    cellX(right - 1, bottom - 1),
  ];
  const ys = [
    cellY(left, top),
    cellY(right - 1, top),
    cellY(left, bottom - 1),
    cellY(right - 1, bottom - 1),
  ];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const cols = Math.max(...xs) - minX + 1;
  const rows = Math.max(...ys) - minY + 1;
  const count = cols * rows;
  if (!Number.isSafeInteger(count) || count > 2_000_000 || count < 1) {
    throw new RangeError('Mosaic grid exceeds two million cells; increase block size.');
  }
  // Five channels per cell: alpha-weighted RGB, alpha, sample count (<=80 MB).
  const cells = new Float64Array(count * 5);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const cell = ((cellY(x, y) - minY) * cols + cellX(x, y) - minX) * 5;
      const pixel = (y * image.width + x) * 4;
      const alpha = image.data[pixel + 3]!;
      for (let channel = 0; channel < 3; channel++)
        cells[cell + channel]! += image.data[pixel + channel]! * alpha;
      cells[cell + 3]! += alpha;
      cells[cell + 4]! += 1;
    }
  }
  const out = new ImageData(image.width, image.height);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const cell = ((cellY(x, y) - minY) * cols + cellX(x, y) - minX) * 5;
      const pixel = (y * image.width + x) * 4;
      const alpha = cells[cell + 3]!;
      if (alpha === 0) continue;
      for (let channel = 0; channel < 3; channel++)
        out.data[pixel + channel] = Math.round(cells[cell + channel]! / alpha);
      out.data[pixel + 3] = Math.round(alpha / cells[cell + 4]!);
    }
  }
  return out;
}
