/**
 * Black & White adjustment — Photoshop-style per-channel luminance mix.
 *
 * Converts to grayscale using a weighted sum of six color channels
 * (reds, yellows, greens, cyans, blues, magentas), each with user-
 * controllable contribution (-200% to +300%).  Also provides a tint
 * overlay (color + preserveLuminosity).
 *
 * Each of the 6 sliders maps to weight contributions on the RGB channels:
 *   Reds → R, Yellows → R+G, Greens → G, Cyans → G+B, Blues → B, Magentas → R+B
 * Pixel hue determines how membership is distributed across the 6 ranges.
 *
 * Research basis: Photoshop Black & White adjustment layer.
 */

export interface BlackAndWhiteParams {
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
  brightness: number;
  tintColor?: readonly [number, number, number, number];
  preserveLuminosity: boolean;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const RANGE_NAMES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const;

const RANGE_CENTERS = [0, 60, 120, 180, 240, 300];

const RANGE_TO_RGB: Record<string, [number, number, number]> = {
  reds: [1, 0, 0],
  yellows: [1, 1, 0],
  greens: [0, 1, 0],
  cyans: [0, 1, 1],
  blues: [0, 0, 1],
  magentas: [1, 0, 1],
};

function pixelHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 0.5) return -1;
  let hue: number;
  if (max === r) {
    hue = 60 * ((g - b) / chroma + (g < b ? 6 : 0));
  } else if (max === g) {
    hue = 60 * ((b - r) / chroma + 2);
  } else {
    hue = 60 * ((r - g) / chroma + 4);
  }
  return ((hue % 360) + 360) % 360;
}

function rangeMembership(hue: number, center: number): number {
  const dist = Math.abs(((hue - center + 540) % 360) - 180);
  return Math.max(0, 1 - dist / 60);
}

export function applyBlackAndWhite(data: ImageData, params: BlackAndWhiteParams): void {
  const pixels = data.data;
  const brightness = Math.max(-100, Math.min(100, params.brightness ?? 0));
  const brightnessScale = 1 + brightness / 100;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    if (a === 0) continue;

    const hue = pixelHue(r, g, b);

    if (hue < 0) {
      const gray = clampByte((0.2126 * r + 0.7152 * g + 0.0722 * b) * brightnessScale);
      if (params.tintColor) {
        const tc = params.tintColor;
        const lum = gray / 255;
        pixels[i] = clampByte(tc[0]! * lum);
        pixels[i + 1] = clampByte(tc[1]! * lum);
        pixels[i + 2] = clampByte(tc[2]! * lum);
      } else {
        pixels[i] = gray;
        pixels[i + 1] = gray;
        pixels[i + 2] = gray;
      }
      continue;
    }

    const memberships: number[] = [];
    for (let ci = 0; ci < 6; ci++) {
      memberships.push(rangeMembership(hue, RANGE_CENTERS[ci]!));
    }

    let weightR = 0;
    let weightG = 0;
    let weightB = 0;

    const sliderValues = [
      params.reds + 100,
      params.yellows + 100,
      params.greens + 100,
      params.cyans + 100,
      params.blues + 100,
      params.magentas + 100,
    ];

    for (let ci = 0; ci < 6; ci++) {
      const m = memberships[ci]!;
      if (m <= 0) continue;
      const sv = sliderValues[ci]!;
      const rgb = RANGE_TO_RGB[RANGE_NAMES[ci]!]!;
      weightR += m * sv * rgb[0];
      weightG += m * sv * rgb[1];
      weightB += m * sv * rgb[2];
    }

    const totalWeight = weightR + weightG + weightB;
    let gray: number;
    if (totalWeight > 0) {
      gray = clampByte(((r * weightR + g * weightG + b * weightB) / totalWeight) * brightnessScale);
    } else {
      gray = clampByte((0.2126 * r + 0.7152 * g + 0.0722 * b) * brightnessScale);
    }

    if (params.tintColor) {
      const tc = params.tintColor;
      if (params.preserveLuminosity) {
        const lum = gray / 255;
        pixels[i] = clampByte(tc[0]! * lum);
        pixels[i + 1] = clampByte(tc[1]! * lum);
        pixels[i + 2] = clampByte(tc[2]! * lum);
      } else {
        const tf = gray / 255;
        pixels[i] = clampByte(r + (tc[0]! - r) * tf);
        pixels[i + 1] = clampByte(g + (tc[1]! - g) * tf);
        pixels[i + 2] = clampByte(b + (tc[2]! - b) * tf);
      }
    } else {
      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
    }
  }
}
