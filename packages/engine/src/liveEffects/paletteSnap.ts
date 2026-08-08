/**
 * Palette Snap — non-destructive quantization to an explicit palette.
 *
 * Never changes the document's colour mode. The palette is stored inline on
 * the effect (copied from document swatches or an imported .gpl/.ase/.aco/.act
 * file at edit time), so rendering is fully deterministic and standalone.
 *
 * Nearest-colour matching can run in RGB, linear RGB, Lab, or OKLab, with an
 * optional dither pass (reusing the Dither kernel's primitives). Transparent
 * pixels stay transparent unless the palette itself has no alpha concept.
 */

import { applyDither, type CoordSpace, type DitherAlgorithm } from './dither';
import type { ColorMetric } from './paletteCore';
import { buildPaletteLookup, dedupePalette, sanitizePalette } from './paletteCore';

export interface PaletteSnapParams {
  /** Palette colours as [r, g, b]. */
  colors: readonly (readonly number[])[];
  /** Matching metric. */
  metric: ColorMetric;
  /** Mix the snapped colour with the source (0 = unchanged, 1 = full snap). */
  amount: number;
  /** Whether to dither the quantization error. */
  dither: boolean;
  ditherAlgorithm: DitherAlgorithm;
  /** 0..1 dither strength. */
  ditherStrength: number;
  /** Pixels below this alpha are forced fully transparent. */
  alphaCutoff: number;
  seed: number;
}

/** Apply palette snapping in place. Returns the same ImageData. */
export function applyPaletteSnap(
  imageData: ImageData,
  params: PaletteSnapParams,
  coordSpace?: CoordSpace,
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const colors = sanitizePalette(params.colors ?? []);
  const amount = clamp01(params.amount ?? 1);
  const alphaCutoff = clamp01(params.alphaCutoff ?? 0);
  if (colors.length === 0 || amount <= 0) return imageData;

  const lookup = buildPaletteLookup(colors, params.metric ?? 'rgb');

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a / 255 < alphaCutoff || a === 0) continue;
    const c = lookup.find(data[i]!, data[i + 1]!, data[i + 2]!);
    if (amount >= 1) {
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
    } else {
      data[i] = Math.round(data[i]! + (c[0] - data[i]!) * amount);
      data[i + 1] = Math.round(data[i + 1]! + (c[1] - data[i + 1]!) * amount);
      data[i + 2] = Math.round(data[i + 2]! + (c[2] - data[i + 2]!) * amount);
    }
  }

  if (params.dither && params.ditherStrength > 0) {
    applyDither(
      imageData,
      {
        algorithm: params.ditherAlgorithm ?? 'floyd-steinberg',
        paletteMode: 'custom',
        levels: 4,
        colors: dedupePalette(colors),
        metric: params.metric ?? 'rgb',
        serpentine: true,
        strength: params.ditherStrength,
        bayerSize: 4,
        cellSize: 1,
        alphaCutoff,
        seed: params.seed ?? 0,
      },
      coordSpace,
    );
  }
  return imageData;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
