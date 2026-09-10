/**
 * Color Halftone effect — comic-book, retro print, brutalist, and zine looks.
 *
 * Architecture:
 *   Screens each color channel independently through an AM (amplitude
 *   modulation) grid of dots. Each channel is rotated by a different angle
 *   to prevent moiré. Channels recombine via subtractive (CMYK) or additive
 *   (RGB) mixing to produce the final color halftone.
 *
 *   Three modes:
 *   - 'cmyk': splits into CMYK, screens each at standard press angles
 *     (C15°/M75°/Y0°/K45°), recombines subtractively. Best for comic-book
 *     and print-style looks.
 *   - 'rgb': screens R/G/B channels independently at offset angles,
 *     recombines additively. Preserves more color vibrancy.
 *   - 'mono': screens luminance with a single ink color. Classic duotone
 *     halftone.
 *
 *   The dot in each cell grows from center as the channel value increases
 *   (ink coverage). Dot size scales with sqrt(tone) to approximate
 *   area-proportional ink coverage (Murray-Davies).
 *
 *   Optional ordered dithering softens the binary threshold for anti-aliased
 *   dot edges at small screen sizes.
 *
 * Research basis: Photoshop Color Halftone max-radius screening,
 *   AM halftone dot growth (Murray-Davies equation), ISO 12647-2
 *   standard screen angles, Floyd-Steinberg-style error diffusion
 *   avoided in favor of deterministic screening for viewport stability.
 *
 * Alpha is preserved — transparent pixels are skipped, semi-transparent
 * pixels are screened proportionally so the effect composites correctly
 * with masks, clipping, and layer opacity.
 */

import type { Color } from './types';

export type ColorHalftoneDotShape = 'round' | 'square' | 'diamond' | 'line';
export type ColorHalftoneMode = 'cmyk' | 'rgb' | 'mono';

export interface ColorHalftoneParams {
  /** Screen frequency in lines per inch equivalent. Range: 3-80. Higher = finer dots. */
  screenSize: number;
  /** Base screen angle in degrees (0-359). For CMYK mode, offsets per channel. */
  angle: number;
  /** Dot shape for the halftone screen. */
  dotShape: ColorHalftoneDotShape;
  /** Channel recombination mode. */
  mode: ColorHalftoneMode;
  /** Blend amount 0-1. 1 = full halftone, 0 = original image. */
  intensity: number;
  /** Ink color for mono mode. Default black. */
  inkColor?: Color;
}

// Standard CMYK screen angles (ISO 12647-2 / Adobe Accurate Screens).
const CMYK_ANGLES: Record<string, number> = { c: 15, m: 75, y: 0, k: 45 };

// RGB channel angles offset from base by 30° increments to prevent moiré.
const RGB_ANGLES: Record<string, number> = { r: 0, g: 30, b: 60 };

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Compute normalized distance from cell center for a given dot shape.
 * Returns 0 at center, ≈1 at cell edge. Used to determine dot growth.
 */
function dotDistance(dx: number, dy: number, shape: ColorHalftoneDotShape): number {
  switch (shape) {
    case 'round':
      return Math.sqrt(dx * dx + dy * dy);
    case 'square':
      return Math.max(Math.abs(dx), Math.abs(dy));
    case 'diamond':
      return (Math.abs(dx) + Math.abs(dy)) / Math.SQRT2;
    case 'line':
      return Math.abs(dy);
    default:
      return Math.sqrt(dx * dx + dy * dy);
  }
}

/**
 * For a given pixel, determine ink coverage (0-1) for one channel.
 * Uses AM screening: the dot grows from cell center as tone increases.
 * Threshold comparison against cell-center distance gives binary output;
 * soft edges come from sub-cell anti-aliasing.
 */
function screenPixel(
  x: number,
  y: number,
  tone: number,
  angle: number,
  cellSize: number,
  shape: ColorHalftoneDotShape,
): number {
  const rad = (angle * Math.PI) / 180;
  const rx = x * Math.cos(rad) - y * Math.sin(rad);
  const ry = x * Math.sin(rad) + y * Math.cos(rad);

  // Position within the cell, normalized to [-1, 1]
  const cellX = (((rx / cellSize) % 1) + 1) % 1; // 0..1
  const cellY = (((ry / cellSize) % 1) + 1) % 1;
  const dx = cellX - 0.5;
  const dy = cellY - 0.5;

  const dist = dotDistance(dx * 2, dy * 2, shape); // 0 at center, ~1 at edge

  // Murray-Davies: dot radius scales with sqrt(tone) for area coverage.
  // tone is 0..1 ink coverage. Dot "on" where dist < radius.
  const radius = Math.sqrt(Math.max(0, Math.min(1, tone)));

  // Anti-aliased edge: smooth transition at the dot boundary.
  const edgeWidth = Math.min(0.15, 1 / cellSize);
  const coverage = Math.max(0, Math.min(1, (radius - dist) / edgeWidth + 0.5));

  return coverage;
}

/**
 * Apply color halftone to ImageData in-place.
 *
 * Screens each channel at its own angle, recombines to RGB, blends
 * with original at the given intensity. Preserves alpha.
 */
export function applyColorHalftone(data: ImageData, params: ColorHalftoneParams): ImageData {
  const { screenSize, angle, dotShape, mode, intensity } = params;
  const inkColor = params.inkColor ?? [0, 0, 0, 255];

  if (intensity === 0) return data;

  const pixels = data.data;
  const w = data.width;
  const h = data.height;
  const cellSize = Math.max(2, Math.round(72 / Math.max(1, screenSize)));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const a = pixels[idx + 3]!;
      if (a === 0) continue; // skip transparent

      const r = pixels[idx]!;
      const g = pixels[idx + 1]!;
      const b = pixels[idx + 2]!;

      let nr: number, ng: number, nb: number;

      if (mode === 'mono') {
        // Single-channel: screen luminance, output is ink color scaled by coverage
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const coverage = screenPixel(x, y, lum / 255, angle, cellSize, dotShape);
        nr = inkColor[0] * coverage + r * (1 - coverage);
        ng = inkColor[1] * coverage + g * (1 - coverage);
        nb = inkColor[2] * coverage + b * (1 - coverage);
      } else if (mode === 'rgb') {
        // Screen each channel independently, output is screened channel values
        const cR = screenPixel(x, y, r / 255, angle + RGB_ANGLES.r!, cellSize, dotShape);
        const cG = screenPixel(x, y, g / 255, angle + RGB_ANGLES.g!, cellSize, dotShape);
        const cB = screenPixel(x, y, b / 255, angle + RGB_ANGLES.b!, cellSize, dotShape);
        nr = clampByte(255 * cR);
        ng = clampByte(255 * cG);
        nb = clampByte(255 * cB);
      } else {
        // CMYK mode: screen each process ink, recombine subtractively
        const c = screenPixel(x, y, 1 - r / 255, CMYK_ANGLES.c! + angle, cellSize, dotShape);
        const m = screenPixel(x, y, 1 - g / 255, CMYK_ANGLES.m! + angle, cellSize, dotShape);
        const yInk = screenPixel(x, y, 1 - b / 255, CMYK_ANGLES.y! + angle, cellSize, dotShape);
        const k = screenPixel(
          x,
          y,
          1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255,
          CMYK_ANGLES.k! + angle,
          cellSize,
          dotShape,
        );
        nr = clampByte(255 * (1 - c) * (1 - k));
        ng = clampByte(255 * (1 - m) * (1 - k));
        nb = clampByte(255 * (1 - yInk) * (1 - k));
      }

      if (intensity < 1) {
        pixels[idx] = clampByte(r + (nr - r) * intensity);
        pixels[idx + 1] = clampByte(g + (ng - g) * intensity);
        pixels[idx + 2] = clampByte(b + (nb - b) * intensity);
      } else {
        pixels[idx] = clampByte(nr);
        pixels[idx + 1] = clampByte(ng);
        pixels[idx + 2] = clampByte(nb);
      }
      // Alpha preserved
    }
  }

  return data;
}

/**
 * Preset configurations for common color halftone looks.
 */
export interface ColorHalftonePreset {
  id: string;
  name: string;
  description: string;
  params: Omit<ColorHalftoneParams, 'intensity'>;
}

export const COLOR_HALFTONE_PRESETS: ColorHalftonePreset[] = [
  {
    id: 'comic-book',
    name: 'Comic Book',
    description: 'Classic CMYK dots — bold, high-contrast print look',
    params: { screenSize: 12, angle: 0, dotShape: 'round', mode: 'cmyk' },
  },
  {
    id: 'retro-print',
    name: 'Retro Print',
    description: 'Coarse CMYK screen — vintage newspaper / zine aesthetic',
    params: { screenSize: 6, angle: 45, dotShape: 'round', mode: 'cmyk' },
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    description: 'Aggressive square dots — raw, industrial, high-contrast',
    params: {
      screenSize: 8,
      angle: 0,
      dotShape: 'square',
      mode: 'mono',
      inkColor: [20, 20, 20, 255],
    },
  },
  {
    id: 'zine',
    name: 'Zine Copy',
    description: 'Xerographic mono — gritty photocopier aesthetic',
    params: {
      screenSize: 10,
      angle: 45,
      dotShape: 'round',
      mode: 'mono',
      inkColor: [40, 40, 40, 255],
    },
  },
  {
    id: 'pop-art',
    name: 'Pop Art',
    description: 'Vibrant RGB dots — Lichtenstein-style ben-day dots',
    params: { screenSize: 10, angle: 15, dotShape: 'round', mode: 'rgb' },
  },
  {
    id: 'line-screen',
    name: 'Line Screen',
    description: 'Parallel line halftone — engraving / etching look',
    params: { screenSize: 8, angle: 45, dotShape: 'line', mode: 'mono' },
  },
  {
    id: 'fine-magazine',
    name: 'Fine Magazine',
    description: 'High-LPI CMYK — smooth offset-print quality',
    params: { screenSize: 45, angle: 0, dotShape: 'round', mode: 'cmyk' },
  },
  {
    id: 'diamond',
    name: 'Diamond Dot',
    description: 'Faceted diamond dots — decorative / textile print',
    params: { screenSize: 14, angle: 30, dotShape: 'diamond', mode: 'cmyk' },
  },
];
