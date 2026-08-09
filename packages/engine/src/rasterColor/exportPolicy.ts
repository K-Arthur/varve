/**
 * Raster export colour policy — what an exported raster file claims.
 *
 * A colour policy names a destination encoding (primaries + transfer) and
 * whether an ICC profile is embedded. The policy is *explicit*: choosing
 * "Display P3" runs a real conversion from the rendered sRGB composite and
 * embeds a P3 profile; it never merely relabels sRGB bytes. "sRGB" is the
 * default and stays the honest label when no conversion is requested.
 *
 * Honest disclosure rules (enforced at the call site):
 *  - WebP cannot embed profiles on this pipeline (simple VP8X output) —
 *    the UI discloses this instead of silently dropping the profile.
 *  - JPEG is 8-bit; high-bit-depth sources converted to JPEG report
 *    precision loss (canvas output is 8-bit regardless, so no extra step).
 */

import type { RasterColorEncoding } from '@varve/shared';
import {
  isAnalyticRgbWorkingSpace,
  type RgbPrimariesName,
  type TransferFunctionName,
} from '@varve/shared';
import { DEFAULT_PIPELINE_WORKING_SPACE } from '../exportPipeline/pipeline';
import { buildMatrixProfile, defaultTransferFor } from './profiles';
import { createAnalyticRgbTransform, type RasterColorTransform } from './transform';

/** Named destination encodings offered by the export UI. */
export const EXPORT_COLOR_POLICIES = ['srgb', 'display-p3', 'adobe-rgb', 'pro-photo'] as const;

export type ExportColorSpaceChoice = (typeof EXPORT_COLOR_POLICIES)[number];

/** Colour policy for one raster export. */
export interface RasterExportColorPolicy {
  /** Destination primaries; undefined/srgb = as-rendered sRGB composite. */
  destination?: ExportColorSpaceChoice;
  /** Destination transfer; defaults per primaries family. */
  transfer?: TransferFunctionName;
  /** Embed a matrix/TRC ICC profile in the output (PNG/JPEG). */
  embedProfile?: boolean;
}

/** Resolve the destination encoding for a policy (defaults sRGB). */
export function resolveExportEncoding(policy?: RasterExportColorPolicy): RasterColorEncoding {
  const primaries: RgbPrimariesName = policy?.destination ?? 'srgb';
  const transfer = policy?.transfer ?? defaultTransferFor(primaries);
  return {
    model: 'rgb',
    primaries,
    transfer,
    bitDepth: 8,
    alphaMode: 'straight',
    provenance: 'user-assigned',
  };
}

/** Short human label for a policy (used in dialogs and logs). */
export function exportColorPolicyLabel(policy: RasterExportColorPolicy | undefined): string {
  const encoding = resolveExportEncoding(policy);
  switch (encoding.primaries) {
    case 'srgb':
      return 'sRGB';
    case 'display-p3':
      return 'Display P3';
    case 'adobe-rgb':
      return 'Adobe RGB (1998)';
    case 'pro-photo':
      return 'ProPhoto RGB';
    default:
      return 'sRGB';
  }
}

/**
 * Build the transform that converts the rendered sRGB composite into the
 * policy destination. Null when the destination is not analytically
 * convertible.
 */
export function createExportTransform(
  policy: RasterExportColorPolicy,
): RasterColorTransform | null {
  const target = resolveExportEncoding(policy);
  const source: RasterColorEncoding = {
    model: 'rgb',
    primaries: 'srgb',
    transfer: DEFAULT_PIPELINE_WORKING_SPACE === 'linear-srgb' ? 'linear' : 'srgb',
    bitDepth: 8,
    alphaMode: 'straight',
    provenance: 'format-default',
  };
  if (
    !isAnalyticRgbWorkingSpace({
      primaries: target.primaries ?? 'srgb',
      transfer: target.transfer ?? 'srgb',
    })
  ) {
    return null;
  }
  return createAnalyticRgbTransform(source, target);
}

/**
 * Convert export ImageData (rendered sRGB composite) to the policy
 * destination in place. Returns the warnings to surface (e.g. unsupported
 * destination → no conversion applied).
 */
export async function convertExportImageData(
  pixels: ImageData,
  policy: RasterExportColorPolicy | undefined,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!policy?.destination || policy.destination === 'srgb') return [];
  const transform = createExportTransform(policy);
  if (!transform) {
    return [
      `colour: destination ${policy.destination} is not analytically convertible; output stays sRGB`,
    ];
  }
  await transform.convertImageData(pixels, signal);
  return [`colour: converted composite to ${exportColorPolicyLabel(policy)} (analytic matrix)`];
}

/** ICC profile bytes to embed for a policy (undefined when not embeddable). */
export function exportProfileBytes(policy: RasterExportColorPolicy | undefined): Uint8Array | null {
  if (!policy?.embedProfile) return null;
  const encoding = resolveExportEncoding(policy);
  if (encoding.primaries === undefined || encoding.primaries === 'unknown') return null;
  try {
    return buildMatrixProfile(encoding.primaries, encoding.transfer);
  } catch {
    return null;
  }
}
