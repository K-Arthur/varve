export const HUE_SATURATION_RANGES = [
  'master',
  'reds',
  'yellows',
  'greens',
  'cyans',
  'blues',
  'magentas',
] as const;

export type HueSaturationRange = (typeof HUE_SATURATION_RANGES)[number];

export interface HueSaturationRangeParams {
  hue: number;
  saturation: number;
  lightness: number;
}

export type HueSaturationParams = Record<HueSaturationRange, HueSaturationRangeParams>;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / Math.max(1e-9, max + min);
  let hue = 0;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hueToRgb(p: number, q: number, t: number): number {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation <= 0) return [lightness, lightness, lightness];
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const h = hue / 360;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function rangeWeight(range: HueSaturationRange, hue: number): number {
  if (range === 'master') return 1;
  const centers: Record<Exclude<HueSaturationRange, 'master'>, number> = {
    reds: 0,
    yellows: 60,
    greens: 120,
    cyans: 180,
    blues: 240,
    magentas: 300,
  };
  return Math.max(0, 1 - hueDistance(hue, centers[range]) / 60);
}

export function applyHueSaturation(imageData: ImageData, params: HueSaturationParams): void {
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const [hue, saturation, lightness] = rgbToHsl(
      pixels[i]! / 255,
      pixels[i + 1]! / 255,
      pixels[i + 2]! / 255,
    );
    let hueShift = 0;
    let saturationShift = 0;
    let lightnessShift = 0;
    for (const range of HUE_SATURATION_RANGES) {
      const weight = rangeWeight(range, hue);
      const adjustment = params[range];
      hueShift += (adjustment?.hue ?? 0) * weight;
      saturationShift += (adjustment?.saturation ?? 0) * weight;
      lightnessShift += (adjustment?.lightness ?? 0) * weight;
    }
    const [r, g, b] = hslToRgb(
      (hue + hueShift + 360) % 360,
      Math.max(0, Math.min(1, saturation * (1 + saturationShift / 100))),
      Math.max(0, Math.min(1, lightness + lightnessShift / 100)),
    );
    pixels[i] = Math.round(r * 255);
    pixels[i + 1] = Math.round(g * 255);
    pixels[i + 2] = Math.round(b * 255);
  }
}
