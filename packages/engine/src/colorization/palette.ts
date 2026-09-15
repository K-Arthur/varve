/**
 * Deterministic palette colorization.
 *
 * There are two intentionally different mappings:
 * - `shaded` selects a palette hue/chroma while retaining the source L*;
 *   full adherence can therefore produce shaded colors outside the literal
 *   palette.
 * - `strict` quantizes to the authored sRGB palette at adherence 1.0. This
 *   is the mode to use for brand/pixel-art constraints where every opaque
 *   output pixel must be a palette member.
 */

import { labToRgb, rgbToLab } from '../nonSeparable';

export type PaletteMappingMode = 'shaded' | 'strict';

interface PaletteColor {
  r: number;
  g: number;
  b: number;
  lab: [number, number, number];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parsePaletteColor(value: string, index: number): PaletteColor {
  if (typeof value !== 'string') {
    throw new Error(`Invalid palette color at index ${index}`);
  }
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid palette color at index ${index}: expected #RRGGBB`);
  }
  const alpha = match[2] ? Number.parseInt(match[2], 16) : 255;
  if (alpha !== 255) {
    throw new Error(`Invalid palette color at index ${index}: palette alpha must be 255`);
  }
  const hex = match[1]!;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return { r, g, b, lab: rgbToLab(r / 255, g / 255, b / 255) };
}

function nearestPaletteColor(sourceLab: [number, number, number], palette: PaletteColor[]) {
  let nearest = palette[0]!;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const dL = sourceLab[0] - candidate.lab[0];
    const dA = sourceLab[1] - candidate.lab[1];
    const dB = sourceLab[2] - candidate.lab[2];
    const nextDistance = dL * dL + dA * dA + dB * dB;
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = candidate;
    }
  }
  return nearest;
}

function byte(value: number): number {
  return Math.round(Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0)));
}

export function paletteColorize(
  imageData: ImageData,
  palette: readonly string[],
  adherence: number,
  mode: PaletteMappingMode = 'shaded',
): ImageData {
  if (palette.length === 0) throw new Error('Palette colorize requires at least one palette color');
  if (!Number.isFinite(adherence)) throw new Error('Palette adherence must be finite');
  if (mode !== 'shaded' && mode !== 'strict') throw new Error('Unsupported palette mapping mode');
  const colors = palette.map(parsePaletteColor);
  const t = clamp01(adherence);
  const { width, height, data } = imageData;
  const output = new ImageData(width, height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const alpha = data[index + 3] ?? 255;
    if (alpha === 0) {
      output.data[index] = data[index] ?? 0;
      output.data[index + 1] = data[index + 1] ?? 0;
      output.data[index + 2] = data[index + 2] ?? 0;
      output.data[index + 3] = 0;
      continue;
    }

    const sourceRgb: [number, number, number] = [
      (data[index] ?? 0) / 255,
      (data[index + 1] ?? 0) / 255,
      (data[index + 2] ?? 0) / 255,
    ];
    const sourceLab = rgbToLab(sourceRgb[0], sourceRgb[1], sourceRgb[2]);
    const target = nearestPaletteColor(sourceLab, colors);

    if (mode === 'strict' && t >= 1) {
      output.data[index] = target.r;
      output.data[index + 1] = target.g;
      output.data[index + 2] = target.b;
    } else {
      const targetRgb =
        mode === 'strict'
          ? ([target.r / 255, target.g / 255, target.b / 255] as [number, number, number])
          : labToRgb(sourceLab[0], target.lab[1], target.lab[2]);
      output.data[index] = byte((sourceRgb[0] * (1 - t) + targetRgb[0] * t) * 255);
      output.data[index + 1] = byte((sourceRgb[1] * (1 - t) + targetRgb[1] * t) * 255);
      output.data[index + 2] = byte((sourceRgb[2] * (1 - t) + targetRgb[2] * t) * 255);
    }
    output.data[index + 3] = alpha;
  }

  return output;
}

export function validatePalette(palette: readonly string[]): string | null {
  try {
    palette.map(parsePaletteColor);
    return palette.length > 0 ? null : 'Palette colorize requires at least one palette color';
  } catch (error) {
    return error instanceof Error ? error.message : 'Palette contains an invalid color';
  }
}
