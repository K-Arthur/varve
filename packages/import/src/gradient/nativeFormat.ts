/**
 * Application-native gradient preset interchange format (`.varve-gradient.json`
 * / `.varve-gradients.json`).
 *
 * A versioned, human-inspectable JSON wrapper around canonical `GradientPreset`
 * values. Supports single-preset and multi-preset collections, stable ids,
 * color-space identifiers, source metadata, and future migrations (via
 * `version`). Optional preview metadata may be carried but is never treated as
 * authoritative — rendering always derives from the stop data.
 *
 * `LEGACY_NATIVE_GRADIENT_FORMAT` is the format tag used by the pre-rename
 * `.strata-gradient.json` exports produced by the published 0.1.0/0.1.1
 * betas. New files are always written with `NATIVE_GRADIENT_FORMAT`; the
 * decoder keeps accepting the legacy tag so those already-exported files
 * still import.
 */
import { type GradientPreset, type GradientPresetLike, makeGradientPreset } from '@varve/scene';

export const NATIVE_GRADIENT_FORMAT = 'varve-gradient';
export const LEGACY_NATIVE_GRADIENT_FORMAT = 'strata-gradient';
export const NATIVE_GRADIENT_VERSION = 1;

export interface NativeGradientFile {
  format: typeof NATIVE_GRADIENT_FORMAT | typeof LEGACY_NATIVE_GRADIENT_FORMAT;
  version: number;
  gradients: GradientPresetLike[];
}

export function encodeGradientPresets(presets: GradientPreset[]): string {
  const file: NativeGradientFile = {
    format: NATIVE_GRADIENT_FORMAT,
    version: NATIVE_GRADIENT_VERSION,
    gradients: presets,
  };
  return JSON.stringify(file, null, 2);
}

export interface DecodeGradientPresetsResult {
  presets: GradientPreset[];
  warnings: string[];
  skipped: number;
}

/** Decode and validate a native gradient file. Never throws on content. */
export function decodeGradientPresets(text: string): DecodeGradientPresetsResult {
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { presets: [], warnings: ['The file is not valid JSON'], skipped: 0 };
  }
  if (!raw || typeof raw !== 'object') {
    return { presets: [], warnings: ['The gradient file has no object root'], skipped: 0 };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== NATIVE_GRADIENT_FORMAT && obj.format !== LEGACY_NATIVE_GRADIENT_FORMAT) {
    return {
      presets: [],
      warnings: [`Not a ${NATIVE_GRADIENT_FORMAT} file`],
      skipped: 0,
    };
  }
  const version = typeof obj.version === 'number' ? obj.version : 1;
  if (version > NATIVE_GRADIENT_VERSION) {
    warnings.push(
      `File format version ${version} is newer than the supported ${NATIVE_GRADIENT_VERSION}; best-effort import`,
    );
  }
  if (!Array.isArray(obj.gradients)) {
    return { presets: [], warnings: ['The gradient file has no "gradients" array'], skipped: 0 };
  }

  const presets: GradientPreset[] = [];
  let skipped = 0;
  for (const item of obj.gradients) {
    if (
      !item ||
      typeof item !== 'object' ||
      !Array.isArray((item as GradientPresetLike).colorStops)
    ) {
      skipped += 1;
      warnings.push('Skipped a malformed gradient entry');
      continue;
    }
    try {
      presets.push(makeGradientPreset(item as GradientPresetLike));
    } catch {
      skipped += 1;
      warnings.push('Skipped a gradient entry that could not be normalized');
    }
  }
  return { presets, warnings, skipped };
}
