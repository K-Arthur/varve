import type { ImageTreatmentSpace } from '../imageTreatments';
import { bounded, occupiedBounds } from './spatialSampling';

export interface SurfaceSmoothParams {
  radius: number;
  /** RGB edge sensitivity in 8-bit channel units; smaller values protect edges more. */
  sensitivity: number;
}

function smoothPass(
  input: ImageData,
  guide: ImageData,
  radius: number,
  spatial: Float64Array,
  range: Float64Array,
  vertical: boolean,
  bounds: [number, number, number, number],
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(input.data), input.width, input.height);
  for (let y = bounds[1]; y < bounds[3]; y++) {
    for (let x = bounds[0]; x < bounds[2]; x++) {
      const center = (y * input.width + x) * 4;
      if (guide.data[center + 3] === 0) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let sum = 0;
      for (let delta = -radius; delta <= radius; delta++) {
        const sx = vertical ? x : x + delta;
        const sy = vertical ? y + delta : y;
        if (sx < 0 || sy < 0 || sx >= input.width || sy >= input.height) continue;
        const index = (sy * input.width + sx) * 4;
        const difference = Math.max(
          Math.abs(guide.data[index]! - guide.data[center]!),
          Math.abs(guide.data[index + 1]! - guide.data[center + 1]!),
          Math.abs(guide.data[index + 2]! - guide.data[center + 2]!),
        );
        const weight = spatial[delta + radius]! * range[difference]! * input.data[index + 3]!;
        r += input.data[index]! * weight;
        g += input.data[index + 1]! * weight;
        b += input.data[index + 2]! * weight;
        sum += weight;
      }
      if (sum > 0) {
        out.data[center] = Math.round(r / sum);
        out.data[center + 1] = Math.round(g / sum);
        out.data[center + 2] = Math.round(b / sum);
      }
    }
  }
  return out;
}

/**
 * Bounded separable joint bilateral approximation (horizontal, then vertical).
 * Both passes use the original RGB guide, preventing a blurred guide from
 * erasing chromatic boundaries. Encoded sRGB; source alpha is preserved.
 * This is not a full isotropic bilateral solver or an AI denoiser.
 */
export function applySurfaceSmooth(
  image: ImageData,
  params: SurfaceSmoothParams,
  space?: ImageTreatmentSpace,
): ImageData {
  const scale = bounded(space?.pixelsPerUnit, 0.001, 1024, 1);
  const radius = Math.round(bounded(params.radius, 0, 8, 3) * scale);
  const bounds = occupiedBounds(image);
  if (radius === 0 || !bounds) return image;
  if (radius > 128)
    throw new RangeError(
      'Surface Smoothing exceeds 128 raster pixels; reduce radius or export scale.',
    );
  const sensitivity = bounded(params.sensitivity, 1, 128, 24);
  const spatial = new Float64Array(radius * 2 + 1);
  const sigma = Math.max(0.5, radius / 2);
  for (let d = -radius; d <= radius; d++)
    spatial[d + radius] = Math.exp((-d * d) / (2 * sigma * sigma));
  const range = new Float64Array(256);
  for (let d = 0; d < range.length; d++)
    range[d] = Math.exp((-d * d) / (2 * sensitivity * sensitivity));
  const horizontal = smoothPass(image, image, radius, spatial, range, false, bounds);
  return smoothPass(horizontal, image, radius, spatial, range, true, bounds);
}
