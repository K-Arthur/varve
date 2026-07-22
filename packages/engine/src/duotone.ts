/**
 * Duotone tonal mapping — maps image luminance through two user-defined
 * color stops (shadows + highlights) with optional midpoint control.
 *
 * Research basis: Photoshop Duotone mode, gradient map with 2 stops,
 * tritone with 2 active colors, traditional duotone printing.
 */

export interface DuotoneParams {
  shadowColor: readonly [number, number, number, number];
  highlightColor: readonly [number, number, number, number];
  shadowPoint: number;
  highlightPoint: number;
  intensity: number;
  preserveLuminosity: boolean;
  interpolation?: 'smoothstep' | 'linear';
}

function lerp4(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number,
): [number, number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function srgbLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const LUT_SIZE = 256;

export function buildDuotoneLut(params: DuotoneParams): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * 4);
  const interp = params.interpolation ?? 'smoothstep';
  const shadowPoint = Math.max(0, Math.min(1, params.shadowPoint ?? 0.25));
  const highlightPoint = Math.max(0, Math.min(1, params.highlightPoint ?? 0.75));

  for (let i = 0; i < LUT_SIZE; i++) {
    const lum = i / (LUT_SIZE - 1);
    let t: number;
    if (lum <= shadowPoint) {
      t = 0;
    } else if (lum >= highlightPoint) {
      t = 1;
    } else if (interp === 'linear') {
      t = (lum - shadowPoint) / (highlightPoint - shadowPoint);
    } else {
      t = smoothstep(shadowPoint, highlightPoint, lum);
    }
    t = Math.max(0, Math.min(1, t));
    const mapped = lerp4(params.shadowColor, params.highlightColor, t);
    lut[i * 4] = mapped[0];
    lut[i * 4 + 1] = mapped[1];
    lut[i * 4 + 2] = mapped[2];
    lut[i * 4 + 3] = mapped[3];
  }
  return lut;
}

export function applyDuotone(data: ImageData, params: DuotoneParams): void {
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 1));
  const preserveLum = params.preserveLuminosity ?? false;
  const lut = buildDuotoneLut(params);
  const pixels = data.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    if (a === 0) continue;

    const inputLum = srgbLuminance(r, g, b);
    const lumIdx = Math.round(inputLum);
    const idx = Math.max(0, Math.min(LUT_SIZE - 1, lumIdx));
    let outR = lut[idx * 4]!;
    let outG = lut[idx * 4 + 1]!;
    let outB = lut[idx * 4 + 2]!;

    if (intensity < 1) {
      outR = r + (outR - r) * intensity;
      outG = g + (outG - g) * intensity;
      outB = b + (outB - b) * intensity;
    }

    if (preserveLum) {
      const mappedLum = srgbLuminance(outR, outG, outB);
      if (mappedLum > 0.5) {
        const ratio = inputLum / mappedLum;
        outR = clampByte(outR * ratio);
        outG = clampByte(outG * ratio);
        outB = clampByte(outB * ratio);
      } else {
        outR = clampByte(outR * (inputLum / 255));
        outG = clampByte(outG * (inputLum / 255));
        outB = clampByte(outB * (inputLum / 255));
      }
    } else {
      outR = clampByte(outR);
      outG = clampByte(outG);
      outB = clampByte(outB);
    }

    pixels[i] = outR;
    pixels[i + 1] = outG;
    pixels[i + 2] = outB;
  }
}
