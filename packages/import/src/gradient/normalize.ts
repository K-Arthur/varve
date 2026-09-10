/**
 * Normalize parsed gradient data into the canonical `GradientPreset` model
 * (`@varve/scene`). Keeps source metadata and compatibility info.
 */
import {
  type GradientCompatibilityInfo,
  type GradientPreset,
  type GradientPresetSource,
  gradientPresetContentHash,
  makeGradientPreset,
} from '@varve/scene';

import type { ParsedGradient } from './photoshopGrd';

/**
 * Convert a parsed `.grd` gradient into a canonical preset.
 *
 * Noise gradients are imported as `kind: 'noise'` with a read-only
 * compatibility warning (the stochastic ramp cannot be reproduced without
 * Photoshop's PRNG). Unsupported color models were already approximated to
 * sRGB by the parser; the approximation is recorded so the UI can surface it.
 */
export function normalizeParsedGradient(
  g: ParsedGradient,
  index: number,
  fileName?: string,
): GradientPreset {
  const source: GradientPresetSource = {
    origin: g.sourceVersion === 'legacy' ? 'photoshop-grd-legacy' : 'photoshop-grd',
    ...(fileName ? { fileName } : {}),
    ...(g.originalName !== g.name ? { originalName: g.originalName } : {}),
    importedAt: new Date().toISOString(),
  };

  const compatibility: GradientCompatibilityInfo | undefined = g.isNoise
    ? {
        status: 'unsupported',
        message: 'Noise gradient imported as read-only',
        warnings: g.warnings,
      }
    : g.warnings.length > 0
      ? { status: 'approximated', message: g.warnings[0], warnings: g.warnings }
      : { status: 'ok' };

  return makeGradientPreset({
    name: g.name || g.originalName || `Gradient ${index + 1}`,
    kind: g.isNoise ? 'noise' : 'solid',
    colorStops: g.colorStops.map((s) => ({
      position: s.position,
      midpoint: s.midpoint,
      color: { space: 'rgb', r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3] },
    })),
    opacityStops: g.opacityStops.map((s) => ({
      position: s.position,
      midpoint: s.midpoint,
      opacity: s.opacity,
    })),
    ...(g.smoothness !== undefined ? { smoothness: g.smoothness } : {}),
    interpolation: 'oklab',
    source,
    originalMetadata: {
      format: 'photoshop-grd',
      colorModels: Array.from(new Set(g.colorStops.map((s) => s.colorModel))),
    },
    ...(compatibility ? { compatibility } : {}),
  });
}

/** Normalize a list of parsed gradients (drop content-identical duplicates). */
export function normalizeParsedGradients(
  gradients: ParsedGradient[],
  fileName?: string,
): { presets: GradientPreset[]; skipped: string[] } {
  const presets: GradientPreset[] = [];
  const skipped: string[] = [];
  const seenHashes = new Set<string>();
  for (let i = 0; i < gradients.length; i++) {
    const preset = normalizeParsedGradient(gradients[i]!, i, fileName);
    const hash = gradientPresetContentHash(preset);
    if (seenHashes.has(hash)) {
      skipped.push(preset.name);
      continue;
    }
    seenHashes.add(hash);
    presets.push(preset);
  }
  return { presets, skipped };
}
