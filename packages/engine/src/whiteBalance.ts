import { linearToSrgbUnit, srgbToLinearUnit } from '@varve/shared';

export interface RelativeWhiteBalanceParams {
  temperature: number;
  tint: number;
  redGain: number;
  greenGain: number;
  blueGain: number;
}
export type WhiteBalanceEstimate =
  | { ok: true; gains: [number, number, number]; samples: number }
  | { ok: false; reason: string };

const LUMA = [0.2126, 0.7152, 0.0722] as const;
const clamp = (v: number, min: number, max: number, fallback: number) =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

/** Relative rendered-RGB gains, not RAW Kelvin or an illuminant estimate. */
export function applyRelativeWhiteBalance(
  data: ImageData,
  params: RelativeWhiteBalanceParams,
): void {
  const t = clamp(params.temperature, -100, 100, 0) / 100;
  const tint = clamp(params.tint, -100, 100, 0) / 100;
  const gains = [
    clamp(params.redGain, 0.25, 4, 1) * 2 ** (t + tint / 2),
    clamp(params.greenGain, 0.25, 4, 1) * 2 ** -tint,
    clamp(params.blueGain, 0.25, 4, 1) * 2 ** (-t + tint / 2),
  ];
  if (gains.every((v) => v === 1)) return;
  const tables = gains.map((gain) =>
    Uint8Array.from({ length: 256 }, (_, v) =>
      Math.round(255 * linearToSrgbUnit(Math.min(1, srgbToLinearUnit(v / 255) * gain))),
    ),
  );
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) data.data[i + c] = tables[c]![data.data[i + c]!]!;
  }
}

/** Joint source pixels only. Samples with partial alpha, clipped channels or
 * near-black channels are excluded. Auto accepts low-chroma evidence only. */
export function estimateRelativeWhiteBalance(
  source: ImageData,
  patch?: { x: number; y: number; radius: number },
): WhiteBalanceEstimate {
  const sums = [0, 0, 0];
  let count = 0,
    visible = 0;
  const radius = patch ? Math.max(0, Math.min(8, Math.round(patch.radius))) : 0;
  const x0 = patch ? Math.max(0, Math.round(patch.x) - radius) : 0,
    x1 = patch ? Math.min(source.width - 1, Math.round(patch.x) + radius) : source.width - 1;
  const y0 = patch ? Math.max(0, Math.round(patch.y) - radius) : 0,
    y1 = patch ? Math.min(source.height - 1, Math.round(patch.y) + radius) : source.height - 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * source.width + x) * 4;
      if (source.data[i + 3]! < 250) continue;
      visible++;
      const values = [source.data[i]!, source.data[i + 1]!, source.data[i + 2]!];
      const max = Math.max(...values),
        min = Math.min(...values);
      if (min < 12 || max > 243 || (!patch && (max - min) / max > 0.15)) continue;
      for (let c = 0; c < 3; c++) sums[c] = sums[c]! + srgbToLinearUnit(values[c]! / 255);
      count++;
    }
  if (count < (patch ? 1 : 16) || (!patch && count < visible * 0.01))
    return {
      ok: false,
      reason: patch
        ? 'Choose an opaque, unclipped neutral patch away from black.'
        : 'Insufficient neutral evidence. Choose a known gray patch instead.',
    };
  const mean = sums.map((v) => v / count),
    target = mean.reduce((v, c, i) => v + c * LUMA[i]!, 0);
  const gains = mean.map((v) => target / v) as [number, number, number];
  if (gains.some((v) => !Number.isFinite(v) || v < 0.25 || v > 4))
    return {
      ok: false,
      reason: 'This patch needs gains outside the supported relative correction range.',
    };
  return { ok: true, gains, samples: count };
}
