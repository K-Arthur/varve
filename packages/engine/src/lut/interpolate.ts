/**
 * 1D and 3D LUT interpolation routines.
 *
 * Research basis:
 *   GPU Gems 2 ch.24 (Selan) — trilinear texture mapping correction,
 *   Kirchberger (2021) — tetrahedral LUT interpolation comparison,
 *   Kang (1997) — color technology for electronic imaging devices.
 */

import type { Lut1D, Lut3D, LutInterpolation } from './types';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function inputMinForChannel(lut: Lut1D, ch: 'r' | 'g' | 'b'): number {
  if (ch === 'r') return lut.inputMin[0];
  if (ch === 'g') return lut.inputMin[1];
  return lut.inputMin[2];
}

function inputMaxForChannel(lut: Lut1D, ch: 'r' | 'g' | 'b'): number {
  if (ch === 'r') return lut.inputMax[0];
  if (ch === 'g') return lut.inputMax[1];
  return lut.inputMax[2];
}

function curveForChannel(lut: Lut1D, ch: 'r' | 'g' | 'b'): Float64Array {
  if (ch === 'r') return lut.r;
  if (ch === 'g') return lut.g;
  return lut.b;
}

/**
 * Evaluate a 1D LUT at a given input value [0,1].
 * Uses linear interpolation between adjacent entries.
 */
export function sampleLut1D(lut: Lut1D, channel: 'r' | 'g' | 'b', value: number): number {
  const inMin = inputMinForChannel(lut, channel);
  const inMax = inputMaxForChannel(lut, channel);
  const range = inMax - inMin;
  const v = range > 0 ? clamp01((value - inMin) / range) : 0;
  const last = lut.size - 1;
  const pos = v * last;
  const i0 = Math.min(Math.floor(pos), last);
  const i1 = Math.min(i0 + 1, last);
  const t = pos - i0;
  const curve = curveForChannel(lut, channel);
  const v0 = curve[i0]!;
  const v1 = curve[i1]!;
  return lerp(v0, v1, t);
}

/**
 * Apply a 1D LUT to an RGB triplet [0,1].
 */
export function applyLut1D(lut: Lut1D, rgb: [number, number, number]): [number, number, number] {
  return [
    sampleLut1D(lut, 'r', rgb[0]),
    sampleLut1D(lut, 'g', rgb[1]),
    sampleLut1D(lut, 'b', rgb[2]),
  ];
}

/**
 * Trilinear interpolation in a 3D LUT.
 *
 * Computes the weighted average of the 8 corners of the bounding cube
 * that contains the input point. Each corner weight is the product of
 * the fractional distances along each axis to the opposite corner.
 */
export function sampleLut3DTrilinear(
  lut: Lut3D,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const size = lut.size;
  const last = size - 1;

  const ri = clamp01((r - lut.inputMin[0]) / (lut.inputMax[0] - lut.inputMin[0]));
  const gi = clamp01((g - lut.inputMin[1]) / (lut.inputMax[1] - lut.inputMin[1]));
  const bi = clamp01((b - lut.inputMin[2]) / (lut.inputMax[2] - lut.inputMin[2]));

  const rPos = ri * last;
  const gPos = gi * last;
  const bPos = bi * last;

  const r0 = Math.min(Math.floor(rPos), last);
  const g0 = Math.min(Math.floor(gPos), last);
  const b0 = Math.min(Math.floor(bPos), last);
  const r1 = Math.min(r0 + 1, last);
  const g1 = Math.min(g0 + 1, last);
  const b1 = Math.min(b0 + 1, last);

  const tr = rPos - r0;
  const tg = gPos - g0;
  const tb = bPos - b0;
  const sr = 1 - tr;
  const sg = 1 - tg;
  const sb = 1 - tb;

  const idx = (bi: number, gi: number, ri: number): number => ((bi * size + gi) * size + ri) * 3;

  const data = lut.data;

  const readTriple = (bi: number, gi: number, ri: number): [number, number, number] => {
    const base = idx(bi, gi, ri);
    return [data[base]!, data[base + 1]!, data[base + 2]!];
  };

  const c000 = readTriple(b0, g0, r0);
  const c100 = readTriple(b0, g0, r1);
  const c010 = readTriple(b0, g1, r0);
  const c110 = readTriple(b0, g1, r1);
  const c001 = readTriple(b1, g0, r0);
  const c101 = readTriple(b1, g0, r1);
  const c011 = readTriple(b1, g1, r0);
  const c111 = readTriple(b1, g1, r1);

  const c000_r = c000[0],
    c000_g = c000[1],
    c000_b = c000[2];
  const c100_r = c100[0],
    c100_g = c100[1],
    c100_b = c100[2];
  const c010_r = c010[0],
    c010_g = c010[1],
    c010_b = c010[2];
  const c110_r = c110[0],
    c110_g = c110[1],
    c110_b = c110[2];
  const c001_r = c001[0],
    c001_g = c001[1],
    c001_b = c001[2];
  const c101_r = c101[0],
    c101_g = c101[1],
    c101_b = c101[2];
  const c011_r = c011[0],
    c011_g = c011[1],
    c011_b = c011[2];
  const c111_r = c111[0],
    c111_g = c111[1],
    c111_b = c111[2];

  const outR =
    sr * sg * sb * c000_r +
    tr * sg * sb * c100_r +
    sr * tg * sb * c010_r +
    tr * tg * sb * c110_r +
    sr * sg * tb * c001_r +
    tr * sg * tb * c101_r +
    sr * tg * tb * c011_r +
    tr * tg * tb * c111_r;

  const outG =
    sr * sg * sb * c000_g +
    tr * sg * sb * c100_g +
    sr * tg * sb * c010_g +
    tr * tg * sb * c110_g +
    sr * sg * tb * c001_g +
    tr * sg * tb * c101_g +
    sr * tg * tb * c011_g +
    tr * tg * tb * c111_g;

  const outB =
    sr * sg * sb * c000_b +
    tr * sg * sb * c100_b +
    sr * tg * sb * c010_b +
    tr * tg * sb * c110_b +
    sr * sg * tb * c001_b +
    tr * sg * tb * c101_b +
    sr * tg * tb * c011_b +
    tr * tg * tb * c111_b;

  return [outR, outG, outB];
}

/**
 * Tetrahedral interpolation in a 3D LUT.
 *
 * Subdivides each LUT cube into 6 tetrahedra and interpolates within the
 * one containing the input point. Produces smoother results than trilinear
 * for the same grid size, with comparable computational cost.
 *
 * Which tetrahedron is selected depends on the fractional position (tR, tG, tB)
 * within the cube:
 *   tR >= tG >= tB → T1 (R-dominant)
 *   tR >= tB >= tG → T2
 *   tG >= tR >= tB → T3 (G-dominant)
 *   tG >= tB >= tR → T4
 *   tB >= tR >= tG → T5 (B-dominant)
 *   tB >= tG >= tR → T6
 */
export function sampleLut3DTetrahedral(
  lut: Lut3D,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const size = lut.size;
  const last = size - 1;

  const ri = clamp01((r - lut.inputMin[0]) / (lut.inputMax[0] - lut.inputMin[0]));
  const gi = clamp01((g - lut.inputMin[1]) / (lut.inputMax[1] - lut.inputMin[1]));
  const bi = clamp01((b - lut.inputMin[2]) / (lut.inputMax[2] - lut.inputMin[2]));

  const rPos = ri * last;
  const gPos = gi * last;
  const bPos = bi * last;

  const r0 = Math.min(Math.floor(rPos), last);
  const g0 = Math.min(Math.floor(gPos), last);
  const b0 = Math.min(Math.floor(bPos), last);
  const r1 = Math.min(r0 + 1, last);
  const g1 = Math.min(g0 + 1, last);
  const b1 = Math.min(b0 + 1, last);

  const tr = rPos - r0;
  const tg = gPos - g0;
  const tb = bPos - b0;

  const idx = (bi: number, gi: number, ri: number): number => ((bi * size + gi) * size + ri) * 3;
  const data = lut.data;

  const read3 = (bi: number, gi: number, ri: number): [number, number, number] => {
    const base = idx(bi, gi, ri);
    return [data[base]!, data[base + 1]!, data[base + 2]!];
  };

  const c000 = read3(b0, g0, r0);
  const c100 = read3(b0, g0, r1);
  const c010 = read3(b0, g1, r0);
  const c110 = read3(b0, g1, r1);
  const c001 = read3(b1, g0, r0);
  const c101 = read3(b1, g0, r1);
  const c011 = read3(b1, g1, r0);
  const c111 = read3(b1, g1, r1);

  let out: [number, number, number];

  if (tr >= tg && tr >= tb) {
    if (tg >= tb) {
      out = [
        c000[0] + (c100[0] - c000[0]) * tr + (c110[0] - c100[0]) * tg + (c111[0] - c110[0]) * tb,
        c000[1] + (c100[1] - c000[1]) * tr + (c110[1] - c100[1]) * tg + (c111[1] - c110[1]) * tb,
        c000[2] + (c100[2] - c000[2]) * tr + (c110[2] - c100[2]) * tg + (c111[2] - c110[2]) * tb,
      ];
    } else {
      out = [
        c000[0] + (c100[0] - c000[0]) * tr + (c101[0] - c100[0]) * tb + (c111[0] - c101[0]) * tg,
        c000[1] + (c100[1] - c000[1]) * tr + (c101[1] - c100[1]) * tb + (c111[1] - c101[1]) * tg,
        c000[2] + (c100[2] - c000[2]) * tr + (c101[2] - c100[2]) * tb + (c111[2] - c101[2]) * tg,
      ];
    }
  } else if (tg >= tr && tg >= tb) {
    if (tr >= tb) {
      out = [
        c000[0] + (c010[0] - c000[0]) * tg + (c110[0] - c010[0]) * tr + (c111[0] - c110[0]) * tb,
        c000[1] + (c010[1] - c000[1]) * tg + (c110[1] - c010[1]) * tr + (c111[1] - c110[1]) * tb,
        c000[2] + (c010[2] - c000[2]) * tg + (c110[2] - c010[2]) * tr + (c111[2] - c110[2]) * tb,
      ];
    } else {
      out = [
        c000[0] + (c010[0] - c000[0]) * tg + (c011[0] - c010[0]) * tb + (c111[0] - c011[0]) * tr,
        c000[1] + (c010[1] - c000[1]) * tg + (c011[1] - c010[1]) * tb + (c111[1] - c011[1]) * tr,
        c000[2] + (c010[2] - c000[2]) * tg + (c011[2] - c010[2]) * tb + (c111[2] - c011[2]) * tr,
      ];
    }
  } else {
    if (tr >= tg) {
      out = [
        c000[0] + (c001[0] - c000[0]) * tb + (c101[0] - c001[0]) * tr + (c111[0] - c101[0]) * tg,
        c000[1] + (c001[1] - c000[1]) * tb + (c101[1] - c001[1]) * tr + (c111[1] - c101[1]) * tg,
        c000[2] + (c001[2] - c000[2]) * tb + (c101[2] - c001[2]) * tr + (c111[2] - c101[2]) * tg,
      ];
    } else {
      out = [
        c000[0] + (c001[0] - c000[0]) * tb + (c011[0] - c001[0]) * tg + (c111[0] - c011[0]) * tr,
        c000[1] + (c001[1] - c000[1]) * tb + (c011[1] - c001[1]) * tg + (c111[1] - c011[1]) * tr,
        c000[2] + (c001[2] - c000[2]) * tb + (c011[2] - c001[2]) * tg + (c111[2] - c011[2]) * tr,
      ];
    }
  }

  return out;
}

/**
 * Sample a 3D LUT with the chosen interpolation method.
 */
export function sampleLut3D(
  lut: Lut3D,
  r: number,
  g: number,
  b: number,
  method: LutInterpolation = 'tetrahedral',
): [number, number, number] {
  switch (method) {
    case 'nearest': {
      const last = lut.size - 1;
      const ri = clamp01((r - lut.inputMin[0]) / (lut.inputMax[0] - lut.inputMin[0]));
      const gi = clamp01((g - lut.inputMin[1]) / (lut.inputMax[1] - lut.inputMin[1]));
      const bi = clamp01((b - lut.inputMin[2]) / (lut.inputMax[2] - lut.inputMin[2]));
      const ir = Math.round(ri * last);
      const ig = Math.round(gi * last);
      const ib = Math.round(bi * last);
      const idx = ((ib * lut.size + ig) * lut.size + ir) * 3;
      return [lut.data[idx]!, lut.data[idx + 1]!, lut.data[idx + 2]!];
    }
    case 'trilinear':
      return sampleLut3DTrilinear(lut, r, g, b);
    case 'tetrahedral':
      return sampleLut3DTetrahedral(lut, r, g, b);
  }
}
