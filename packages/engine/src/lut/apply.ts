/**
 * Apply a LUT transform to ImageData.
 *
 * Handles 1D LUTs (per-channel curve), 3D LUTs (RGB→RGB with interpolation),
 * and shaper+3D LUTs. Supports colour-space linearization options,
 * alpha preservation, and intensity mixing.
 *
 * Research basis: GPU Gems 2 ch.24 (Selan),
 *   OpenColorIO CPU renderer,
 *   DaVinci Resolve LUT application.
 */

import { linearToSrgb, srgbToLinear } from '@varve/shared';
import { applyLut1D, sampleLut3D } from './interpolate';
import type { LutInterpolation, LutTransform } from './types';

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Apply a LUT transform to an RGBA ImageData buffer.
 * Alpha is preserved (not transformed by the LUT).
 */
export function applyLutToImageData(
  data: ImageData,
  transform: LutTransform,
  intensity: number,
  interpolation: LutInterpolation = 'tetrahedral',
  linearize: boolean = false,
): void {
  const pixels = data.data;
  const len = pixels.length;
  const mix = Math.max(0, Math.min(1, intensity));

  if (mix <= 0) return;

  for (let i = 0; i < len; i += 4) {
    const r = pixels[i]! / 255;
    const g = pixels[i + 1]! / 255;
    const b = pixels[i + 2]! / 255;
    const a = pixels[i + 3]!;

    const lr = linearize ? srgbToLinear(r) : r;
    const lg = linearize ? srgbToLinear(g) : g;
    const lb = linearize ? srgbToLinear(b) : b;

    let outR: number;
    let outG: number;
    let outB: number;

    switch (transform.kind) {
      case '1d': {
        const lutOut = applyLut1D(transform, [lr, lg, lb]);
        outR = lutOut[0];
        outG = lutOut[1];
        outB = lutOut[2];
        break;
      }
      case '3d': {
        const lutOut = sampleLut3D(transform, lr, lg, lb, interpolation);
        outR = lutOut[0];
        outG = lutOut[1];
        outB = lutOut[2];
        break;
      }
      case 'shaper3d': {
        const shaped = applyLut1D(transform.shaper, [lr, lg, lb]);
        const lutOut = sampleLut3D(transform.lut3d, shaped[0], shaped[1], shaped[2], interpolation);
        outR = lutOut[0];
        outG = lutOut[1];
        outB = lutOut[2];
        break;
      }
      default:
        continue;
    }

    if (linearize) {
      outR = linearToSrgb(outR);
      outG = linearToSrgb(outG);
      outB = linearToSrgb(outB);
    }

    if (mix < 1) {
      pixels[i] = clampByte(lerp(r, outR, mix) * 255);
      pixels[i + 1] = clampByte(lerp(g, outG, mix) * 255);
      pixels[i + 2] = clampByte(lerp(b, outB, mix) * 255);
    } else {
      pixels[i] = clampByte(outR * 255);
      pixels[i + 1] = clampByte(outG * 255);
      pixels[i + 2] = clampByte(outB * 255);
    }
    pixels[i + 3] = a;
  }
}
