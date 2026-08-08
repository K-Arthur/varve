/**
 * Live non-destructive dithering kernel.
 *
 * Algorithms: Floyd-Steinberg, Atkinson, Jarvis-Judice-Ninke, Stucki, Sierra,
 * Bayer (2/4/8 ordered), and blue-noise. Error diffusion is inherently
 * sequential; it runs on the CPU in a single row-major pass (serpentine
 * optional) — the same deterministic output the export path produces.
 *
 * Anchoring: when a `coordSpace` is supplied, the pattern phase is anchored
 * to document coordinates so panning/zooming never makes the pattern
 * "swim" relative to layer content. Without it, the pattern anchors to the
 * surface's own pixel grid.
 *
 * Alpha: dithered colour is never applied to pixels whose alpha falls below
 * `alphaCutoff` (they stay transparent), and the alpha channel itself is
 * never modified by dithering.
 */

import {
  bayerThresholdMatrix,
  KERNELS,
  type DitherAlgorithm as TechDitherAlgorithm,
} from '../exportPipeline/dither';
import type { ColorMetric, PaletteColor } from './paletteCore';
import { buildPaletteLookup, sanitizePalette } from './paletteCore';
import { hash2, seeded01 } from './prng';

export type DitherAlgorithm =
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'sierra'
  | 'bayer'
  | 'blue-noise';

export type DitherPaletteMode = 'none' | 'levels' | 'custom';

export interface DitherParams {
  algorithm: DitherAlgorithm;
  paletteMode: DitherPaletteMode;
  /** Bits per channel when paletteMode === 'levels' (1..8). */
  levels: number;
  /** Explicit palette when paletteMode === 'custom'. */
  colors: readonly (readonly number[])[];
  metric: ColorMetric;
  serpentine: boolean;
  /** 0..1 error/pattern strength. */
  strength: number;
  /** Bayer matrix size (2 | 4 | 8). */
  bayerSize: number;
  /** Pattern cell size in document pixels (>= 1). */
  cellSize: number;
  /** Pixels below this alpha are forced fully transparent. 0..1 */
  alphaCutoff: number;
  /** Deterministic seed. */
  seed: number;
}

export interface CoordSpace {
  /** Device pixels per document pixel (camera zoom x dpr). */
  scale: number;
  /** Device x of the document origin (camera transform e). */
  originX: number;
  /** Device y of the document origin (camera transform f). */
  originY: number;
  /** Device x of the rendered region origin (the backdrop capture offset). */
  regionX: number;
  /** Device y of the rendered region origin (the backdrop capture offset). */
  regionY: number;
}

/** Document coordinate of a local (region-space) pixel given a CoordSpace. */
export function docCoordOf(x: number, y: number, coordSpace: CoordSpace): { x: number; y: number } {
  const scale = coordSpace.scale > 0 ? coordSpace.scale : 1;
  return {
    x: (coordSpace.regionX + x - coordSpace.originX) / scale,
    y: (coordSpace.regionY + y - coordSpace.originY) / scale,
  };
}

const LUMINANCE: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/** Apply the dither effect in place (mutates data, returns same ImageData). */
export function applyDither(
  imageData: ImageData,
  params: DitherParams,
  coordSpace?: CoordSpace,
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const algorithm = params.algorithm ?? 'floyd-steinberg';
  const strength = clamp01(params.strength ?? 1);
  const alphaCutoff = clamp01(params.alphaCutoff ?? 0);
  const serpentine = params.serpentine ?? true;
  const seed = Math.round(params.seed ?? 0) >>> 0;

  const scale = coordSpace && coordSpace.scale > 0 ? coordSpace.scale : 1;
  const cell = Math.max(1, params.cellSize ?? 1) * scale;
  const phaseX = coordSpace ? coordSpace.regionX : 0;
  const phaseY = coordSpace ? coordSpace.regionY : 0;
  const originX = coordSpace ? coordSpace.originX : 0;
  const originY = coordSpace ? coordSpace.originY : 0;

  if (algorithm === 'bayer' || algorithm === 'blue-noise') {
    applyOrdered(
      data,
      w,
      h,
      { ...params, algorithm },
      { strength, alphaCutoff, cell, phaseX, phaseY, originX, originY, scale, seed },
    );
    return imageData;
  }

  if (strength <= 0) return imageData;

  // 'none' palette mode = no quantization = no dithering at all. Error
  // diffusion requires a quantization target to diffuse error towards.
  if ((params.paletteMode ?? 'levels') === 'none') return imageData;

  // Palette-based error diffusion: quantize to nearest palette colour per
  // channel; otherwise quantize to levels.
  let palette: PaletteColor[] = [];
  let lookup: { find(r: number, g: number, b: number): PaletteColor } | null = null;
  if (params.paletteMode === 'custom') {
    palette = sanitizePalette(params.colors ?? []);
    if (palette.length > 0) {
      lookup = buildPaletteLookup(palette, params.metric ?? 'rgb');
    }
  }
  const levels = Math.max(1, Math.min(8, Math.round(params.levels ?? 4)));
  const step = 1 / ((1 << levels) - 1);

  const kernelName =
    algorithm === 'sierra' ? 'jarvis-judice-ninke' : (algorithm as TechDitherAlgorithm);
  const kernel = KERNELS[kernelName as keyof typeof KERNELS] ?? KERNELS['floyd-steinberg'];

  const errR = new Float32Array(w * h);
  const errG = new Float32Array(w * h);
  const errB = new Float32Array(w * h);

  for (let y = 0; y < h; y += 1) {
    const ltr = !serpentine || y % 2 === 0;
    for (let sx = 0; sx < w; sx += 1) {
      const x = ltr ? sx : w - 1 - sx;
      const o = (y * w + x) * 4;
      const a = data[o + 3]!;
      if (a / 255 < alphaCutoff || a === 0) {
        continue;
      }
      const eo = y * w + x;
      const r = clamp01(data[o]! / 255 + (errR[eo] ?? 0) * strength);
      const g = clamp01(data[o + 1]! / 255 + (errG[eo] ?? 0) * strength);
      const b = clamp01(data[o + 2]! / 255 + (errB[eo] ?? 0) * strength);

      let qr: number;
      let qg: number;
      let qb: number;
      if (lookup) {
        const c = lookup.find(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
        qr = c[0] / 255;
        qg = c[1] / 255;
        qb = c[2] / 255;
      } else {
        qr = Math.round(r / step) * step;
        qg = Math.round(g / step) * step;
        qb = Math.round(b / step) * step;
      }
      data[o] = Math.round(clamp01(qr) * 255);
      data[o + 1] = Math.round(clamp01(qg) * 255);
      data[o + 2] = Math.round(clamp01(qb) * 255);

      const er = (r - qr) * strength;
      const eg = (g - qg) * strength;
      const eb = (b - qb) * strength;
      for (const entry of kernel) {
        const nx = ltr ? x + entry.dx : x - entry.dx;
        const ny = y + entry.dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const ne = ny * w + nx;
        errR[ne] = (errR[ne] ?? 0) + er * entry.weight;
        errG[ne] = (errG[ne] ?? 0) + eg * entry.weight;
        errB[ne] = (errB[ne] ?? 0) + eb * entry.weight;
      }
    }
  }
  return imageData;
}

interface OrderedState {
  strength: number;
  alphaCutoff: number;
  cell: number;
  phaseX: number;
  phaseY: number;
  originX: number;
  originY: number;
  scale: number;
  seed: number;
}

function applyOrdered(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  params: DitherParams,
  st: OrderedState,
): void {
  const levels = Math.max(1, Math.min(8, Math.round(params.levels ?? 4)));
  const step = 1 / ((1 << levels) - 1);
  let palette: PaletteColor[] = [];
  let lookup: { find(r: number, g: number, b: number): PaletteColor } | null = null;
  if (params.paletteMode === 'custom') {
    palette = sanitizePalette(params.colors ?? []);
    if (palette.length > 0) {
      lookup = buildPaletteLookup(palette, params.metric ?? 'rgb');
    }
  }
  const bayer =
    params.algorithm === 'bayer'
      ? bayerThresholdMatrix(Math.max(2, Math.min(8, params.bayerSize ?? 4)))
      : null;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const a = data[o + 3]!;
      if (a / 255 < st.alphaCutoff || a === 0) continue;
      // Document-anchored phase: the cell index derives from the document
      // coordinate of the pixel, so the pattern is invariant under pan/zoom
      // (a fixed cell in doc px covers a fixed set of doc pixels).
      const invScale = 1 / (st.scale > 0 ? st.scale : 1);
      const docX = (st.phaseX + x - st.originX) * invScale;
      const docY = (st.phaseY + y - st.originY) * invScale;
      const cellSizeDoc = st.cell * invScale;
      const cellIdxX = Math.floor(docX / cellSizeDoc);
      const cellIdxY = Math.floor(docY / cellSizeDoc);
      let threshold: number;
      if (bayer) {
        const size = Math.sqrt(bayer.length);
        const t = (bayer[(cellIdxY % size) * size + (cellIdxX % size)]! + 0.5) / (size * size);
        threshold = (t - 0.5) * st.strength * step * 1.5;
      } else {
        threshold = (hash2(cellIdxX, cellIdxY, st.seed) - 0.5) * st.strength * step;
      }
      const r = clamp01(data[o]! / 255 + threshold);
      const g = clamp01(data[o + 1]! / 255 + threshold);
      const b = clamp01(data[o + 2]! / 255 + threshold);
      if (lookup) {
        const c = lookup.find(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
      } else {
        data[o] = quantizeByte(r, step);
        data[o + 1] = quantizeByte(g, step);
        data[o + 2] = quantizeByte(b, step);
      }
    }
  }
}

function quantizeByte(v: number, step: number): number {
  return Math.round(clamp01(Math.round(v / step) * step) * 255);
}

export function lumaOf(r: number, g: number, b: number): number {
  return (LUMINANCE[0] * r + LUMINANCE[1] * g + LUMINANCE[2] * b) / 255;
}

/** Deterministic seed sequence for UI "shuffle" buttons. */
export function nextDeterministicSeed(seed: number): number {
  return Math.round(seeded01(seed + 0x9e3779b9) * 4294967295);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
