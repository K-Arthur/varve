/**
 * Gradient preset import — public API.
 *
 * Keep the binary parsers isolated from UI, rendering, scene mutation, and
 * file-picker logic: this module only maps bytes/text to canonical
 * `GradientPreset[]` values plus structured warnings. Document state is never
 * touched here.
 */
import type { GradientPreset } from '@varve/scene';
import { GrdError } from './descriptor';
import { detectGradientFormat, type GradientFileFormat } from './detect';
import { decodeGradientPresets } from './nativeFormat';
import { normalizeParsedGradients } from './normalize';
import { parsePhotoshopGrd } from './photoshopGrd';

export * from './descriptor';
export * from './detect';
export * from './nativeFormat';
export * from './normalize';
export * from './photoshopGrd';

export interface GradientImportResult {
  presets: GradientPreset[];
  format: GradientFileFormat;
  /** Non-fatal issues; import succeeded with caveats. */
  warnings: string[];
  /** Names of gradients skipped because they were content-duplicates. */
  skipped: string[];
}

export interface GradientImportError {
  code: string;
  message: string;
  format: GradientFileFormat;
}

/** Import gradient presets from `.grd` bytes or native JSON text. */
export function importGradientPresets(
  input: string | Uint8Array,
  fileName?: string,
): GradientImportResult {
  const format = detectGradientFormat(input);

  if (format === 'varve-gradient-json') {
    const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
    const decoded = decodeGradientPresets(text);
    return {
      presets: decoded.presets,
      format,
      warnings: decoded.warnings,
      skipped: [],
    };
  }

  if (format === 'photoshop-grd' || format === 'photoshop-grd-legacy') {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const parsed = parsePhotoshopGrd(bytes);
    const { presets, skipped } = normalizeParsedGradients(parsed.gradients, fileName);
    return { presets, format, warnings: parsed.warnings, skipped };
  }

  throw {
    code: 'unsupported-format',
    message: 'This file does not appear to be a Photoshop gradient preset or Varve gradient file',
    format,
  } as GradientImportError;
}

/** Map a parser throw to a structured error (for UI messaging). */
export function toGradientImportError(err: unknown): GradientImportError {
  if (err instanceof GrdError) {
    return {
      code: err.code,
      message: err.message,
      format: err.code === 'invalid-signature' ? 'unknown' : 'photoshop-grd',
    };
  }
  if (typeof err === 'object' && err !== null && 'code' in err && 'message' in err) {
    return err as GradientImportError;
  }
  return {
    code: 'unknown',
    message: err instanceof Error ? err.message : 'Unknown import error',
    format: 'unknown',
  };
}
