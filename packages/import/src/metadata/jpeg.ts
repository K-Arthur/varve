/**
 * JPEG colour metadata resolution (ICC APP2 + EXIF ColorSpace) for raster
 * ingestion.
 *
 * Baseline JPEG is 8-bit; colour information arrives via:
 *
 *   APP2 ICC_PROFILE segments — authoritative when a full profile assembles
 *   EXIF ColorSpace (0xA001) — informational: 1 = sRGB, 2 = Adobe RGB,
 *                              65535 = uncalibrated
 *
 * Precedence: a valid embedded ICC profile wins. When EXIF ColorSpace is
 * also present and disagrees (e.g. uncalibrated or Adobe RGB alongside an
 * sRGB profile), the ICC profile stays authoritative and the disagreement
 * is recorded as a diagnostic — never averaged.
 *
 * With no ICC profile, EXIF ColorSpace 1 yields a `named` sRGB encoding;
 * anything else (or nothing) stays explicitly unmanaged.
 */

import type { RasterColorEncoding } from '@varve/shared';
import { parseExifColorSpace } from './exif';
import type { IccExtractionResult } from './icc';

/**
 * Resolve the JPEG colour encoding from its ICC + EXIF metadata.
 * `exifColorSpace` is the raw EXIF ColorSpace tag value (undefined when
 * absent), pre-parsed by `parseExifColorSpace`.
 */
export function resolveJpegEncoding(
  bytes: Uint8Array,
  icc: IccExtractionResult,
): RasterColorEncoding {
  const exifColorSpace = parseExifColorSpace(bytes);
  const diagnostics: string[] = [];

  if (icc.kind === 'valid') {
    if (exifColorSpace !== undefined && exifColorSpace !== 1) {
      diagnostics.push(
        `EXIF ColorSpace (${exifColorSpace === 2 ? 'Adobe RGB' : exifColorSpace === 65535 ? 'uncalibrated' : `value ${exifColorSpace}`}) disagrees with the embedded ICC profile`,
      );
    }
    return {
      model: 'rgb',
      primaries: 'srgb',
      transfer: 'srgb',
      bitDepth: 8,
      alphaMode: 'straight',
      provenance: 'embedded-icc',
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  if (icc.kind === 'invalid') {
    diagnostics.push(`embedded ICC profile invalid: ${icc.reason}`);
  }

  if (exifColorSpace === 1) {
    return {
      model: 'rgb',
      primaries: 'srgb',
      transfer: 'srgb',
      bitDepth: 8,
      alphaMode: 'straight',
      provenance: 'named',
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  if (exifColorSpace === 2) {
    return {
      model: 'rgb',
      primaries: 'adobe-rgb',
      transfer: 'gamma22',
      bitDepth: 8,
      alphaMode: 'straight',
      provenance: 'named',
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  return {
    model: 'rgb',
    primaries: 'unknown',
    transfer: 'unknown',
    bitDepth: 8,
    alphaMode: 'straight',
    provenance: 'format-default',
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}
