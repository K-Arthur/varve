/**
 * TIFF colour metadata parsing (photometric interpretation, bits/sample,
 * planar configuration) for raster ingestion.
 *
 * TIFF carries colour semantics in the baseline tags:
 *
 *   256  ImageWidth
 *   257  ImageLength
 *   258  BitsPerSample
 *   262  PhotometricInterpretation (0 white-is-zero, 1 black-is-zero,
 *        2 RGB, 3 palette, 5 CMYK, 6 YCbCr)
 *   284  PlanarConfiguration (1 chunky, 2 planar)
 *   34675 ICC_Profile (handled by ./icc.ts)
 *
 * Varve does not decode TIFF pixels today (browser/Tauri paths reject it);
 * the encoding record is still written so preflight can describe a placed
 * TIFF honestly instead of assuming sRGB.
 */

import type { RasterColorEncoding, RasterColorModel } from '@varve/shared';
import { type IccExtractionResult, walkTiffIfds } from './icc';

/** PhotometricInterpretation values (TIFF 6.0). */
export type TiffPhotometric =
  | 'white-is-zero'
  | 'black-is-zero'
  | 'rgb'
  | 'palette'
  | 'cmyk'
  | 'ycbcr';

/** Read the first SHORT value of a tag (inline or offset-referenced). */
function readShort(bytes: Uint8Array, tag: number): number | undefined {
  let found: number | undefined;
  walkTiffIfds(bytes, 0, (entryTag, type, count, valueSlot, readU32) => {
    if (entryTag !== tag || found !== undefined) return;
    if (count < 1) return;
    if (type === 3 /* SHORT */ && count === 1) {
      // Inline for SHORT values.
      if (valueSlot + 2 <= bytes.length) {
        const isLe = bytes[0] === 0x49;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        found = view.getUint16(valueSlot, isLe);
      }
    } else if (type === 3 && count > 1 && count <= 4) {
      if (valueSlot + 2 <= bytes.length) {
        const isLe = bytes[0] === 0x49;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        found = view.getUint16(valueSlot, isLe);
      }
    } else if (type === 4 /* LONG */ && count === 1) {
      found = readU32(valueSlot);
    }
  });
  return found;
}

/** Read the first value of a tag that may be an array (SHORTs). */
function readFirstShort(bytes: Uint8Array, tag: number): number | undefined {
  let found: number | undefined;
  walkTiffIfds(bytes, 0, (entryTag, type, count, valueSlot, readU32) => {
    if (entryTag !== tag || found !== undefined || type !== 3 || count < 1) return;
    // Arrays longer than 2 shorts are offset-referenced.
    const valueOffset = count <= 2 ? valueSlot : readU32(valueSlot);
    if (valueOffset + 2 > bytes.length) return;
    const isLe = bytes[0] === 0x49;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    found = view.getUint16(valueOffset, isLe);
  });
  return found;
}

/**
 * Resolve the TIFF colour encoding. An embedded ICC profile wins; otherwise
 * the photometric interpretation determines the model, and the encoding is
 * explicitly unmanaged (provenance 'format-default') — never assumed sRGB.
 */
export function resolveTiffEncoding(
  bytes: Uint8Array,
  icc: IccExtractionResult,
): RasterColorEncoding {
  const photometric = readShort(bytes, 262);
  const bits = readFirstShort(bytes, 258);
  const model: RasterColorModel =
    photometric === 5 ? 'cmyk' : photometric === 2 ? 'rgb' : 'unknown';

  if (icc.kind === 'valid') {
    return {
      model,
      bitDepth: bits === 16 ? 16 : bits !== undefined ? 8 : undefined,
      alphaMode: 'straight',
      provenance: 'embedded-icc',
    };
  }

  const diagnostics: string[] = [];
  if (icc.kind === 'invalid') diagnostics.push(`embedded ICC profile invalid: ${icc.reason}`);

  if (photometric === undefined) {
    return {
      model: 'unknown',
      provenance: 'format-default',
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  return {
    model,
    bitDepth: bits === 16 ? 16 : bits !== undefined ? 8 : undefined,
    alphaMode: 'straight',
    provenance: 'format-default',
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}
