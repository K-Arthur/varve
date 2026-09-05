import type { ImageTreatmentSpace } from '../imageTreatments';
import { bounded, occupiedBounds, rasterVector } from './spatialSampling';

export interface EdgeInkParams {
  radius: number;
  threshold: number;
  softness: number;
  foregroundColor: readonly number[];
  backgroundColor: readonly number[];
  transparentBackground: boolean;
}

function toneField(image: ImageData): Float32Array {
  const field = new Float32Array(image.width * image.height);
  for (let pixel = 0; pixel < field.length; pixel++) {
    const i = pixel * 4;
    const alpha = image.data[i + 3]! / 255;
    field[pixel] =
      ((0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!) /
        255) *
        alpha +
      1 -
      alpha;
  }
  return field;
}

/**
 * Sobel contours of encoded-sRGB luminance composited over white. Scale samples
 * in object axes, then threshold a normalized gradient with smoothstep softness.
 * Paper mode preserves source alpha; transparent mode retains only the ink.
 */
export function applyEdgeInk(
  image: ImageData,
  params: EdgeInkParams,
  space?: ImageTreatmentSpace,
): ImageData {
  const bounds = occupiedBounds(image);
  if (!bounds) return image;
  const radius = bounded(params.radius, 1, 8, 1);
  const vx = rasterVector(radius, 0, space);
  const vy = rasterVector(0, radius, space);
  const threshold = bounded(params.threshold, 0, 1, 0.15);
  const softness = bounded(params.softness, 0, 1, 0.15);
  const ink = [0, 1, 2].map((c) => bounded(params.foregroundColor?.[c], 0, 255, 20));
  const paper = [0, 1, 2].map((c) => bounded(params.backgroundColor?.[c], 0, 255, 255));
  const out = new ImageData(image.width, image.height);
  const tones = toneField(image);
  const taps: Array<{ dx: number; dy: number; gx: number; gy: number }> = [];
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      taps.push({
        dx: Math.round(vx[0] * ox + vy[0] * oy),
        dy: Math.round(vx[1] * ox + vy[1] * oy),
        gx: ox * (oy === 0 ? 2 : 1),
        gy: oy * (ox === 0 ? 2 : 1),
      });
    }
  for (let y = bounds[1]; y < bounds[3]; y++) {
    for (let x = bounds[0]; x < bounds[2]; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] === 0) continue;
      let gx = 0;
      let gy = 0;
      for (const tap of taps) {
        const sx = Math.max(0, Math.min(image.width - 1, x + tap.dx));
        const sy = Math.max(0, Math.min(image.height - 1, y + tap.dy));
        const value = tones[sy * image.width + sx]!;
        gx += value * tap.gx;
        gy += value * tap.gy;
      }
      const magnitude = Math.min(1, Math.hypot(gx, gy) / 4);
      const t =
        softness === 0
          ? Number(magnitude >= threshold)
          : Math.max(0, Math.min(1, (magnitude - threshold) / softness));
      const coverage = t * t * (3 - 2 * t);
      for (let c = 0; c < 3; c++)
        out.data[i + c] = params.transparentBackground
          ? ink[c]!
          : Math.round(paper[c]! * (1 - coverage) + ink[c]! * coverage);
      out.data[i + 3] = Math.round(
        image.data[i + 3]! * (params.transparentBackground === true ? coverage : 1),
      );
    }
  }
  return out;
}
