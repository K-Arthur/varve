import { gamutMapToSrgbUnit, linearSrgbToOklab, srgbToLinearUnit } from '@varve/shared';

export interface SplitToneParams {
  shadowHue: number;
  shadowSaturation: number;
  highlightHue: number;
  highlightSaturation: number;
  balance: number;
  blending: number;
  strength: number;
}
const clamp = (v: number, min: number, max: number, fallback: number) =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const hue = (v: number) => (Number.isFinite(v) ? ((((v % 360) + 360) % 360) * Math.PI) / 180 : 0);

export function splitToneWeights(
  lightness: number,
  balance: number,
  blending: number,
): [number, number] {
  const pivot = clamp(balance, 0, 1, 0.5),
    width = clamp(blending, 0.01, 1, 0.5);
  const t = clamp((lightness - pivot) / width + 0.5, 0, 1, 0);
  const highlights = t * t * (3 - 2 * t);
  return [1 - highlights, highlights];
}

/** Add chroma to the input Oklab lightness ranges; never replace the source
 * with gray. Black/white endpoints are protected. Gamut compression reduces
 * chroma at fixed lightness/hue using the existing shared color owner. */
export function applySplitTone(data: ImageData, params: SplitToneParams): void {
  const strength = clamp(params.strength, 0, 1, 0);
  const shadow = clamp(params.shadowSaturation, 0, 1, 0) * 0.15 * strength;
  const highlight = clamp(params.highlightSaturation, 0, 1, 0) * 0.15 * strength;
  if (shadow === 0 && highlight === 0) return;
  const sh = hue(params.shadowHue),
    hh = hue(params.highlightHue);
  const sa = Math.cos(sh) * shadow,
    sb = Math.sin(sh) * shadow,
    ha = Math.cos(hh) * highlight,
    hb = Math.sin(hh) * highlight;
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i + 3] === 0) continue;
    const [L, a, b] = linearSrgbToOklab([
      srgbToLinearUnit(data.data[i]! / 255),
      srgbToLinearUnit(data.data[i + 1]! / 255),
      srgbToLinearUnit(data.data[i + 2]! / 255),
    ]);
    if (L < 1e-8 || L > 1 - 1e-7) continue;
    const [s, h] = splitToneWeights(L, params.balance, params.blending),
      envelope = 4 * L * (1 - L);
    const na = a + envelope * (sa * s + ha * h),
      nb = b + envelope * (sb * s + hb * h);
    const rgb = gamutMapToSrgbUnit([L, Math.hypot(na, nb), Math.atan2(nb, na)]);
    for (let c = 0; c < 3; c++) data.data[i + c] = Math.round(rgb[c]!);
  }
}
