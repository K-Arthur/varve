/**
 * Normalized source-image metadata for raster ingestion.
 *
 * Combines EXIF orientation, embedded ICC extraction, and a canonical
 * `RasterColorEncoding` record (primaries, transfer, precision, provenance,
 * diagnostics) into one small, serializable model that scene assets can
 * carry. Extraction is purely metadata: no pixel data is decoded or
 * transformed here.
 */

import type {
  RasterAlphaMode,
  RasterColorEncoding,
  RasterColorModel,
  RasterPrecision,
  RgbPrimariesName,
  TransferFunctionName,
  VideoMatrixCoefficients,
  VideoRange,
} from '@varve/shared';
import { extractAvifColorMetadata } from './avif';
import { type ExifOrientation, orientedDimensions, parseExifOrientation } from './exif';
import { type ExtractedIccProfile, extractIccProfile, type IccExtractionResult } from './icc';
import { resolveJpegEncoding } from './jpeg';
import { resolvePngEncoding } from './png';
import { resolveTiffEncoding } from './tiff';

export {
  type ExifOrientation,
  isValidExifOrientation,
  orientedDimensions,
  parseExifOrientation,
} from './exif';
export type { ExtractedIccProfile, IccExtractionResult } from './icc';
export { extractIccProfile } from './icc';
export type { PngColorChunks } from './png';
export { matchNamedPrimaries } from './png';
export type { TiffPhotometric } from './tiff';

/** Metadata outcome for a decoded orientation tag. */
export type OrientationStatus =
  | { kind: 'none' }
  | { kind: 'oriented'; orientation: ExifOrientation };

/** ICC outcome for an ingested image. */
export type SourceIccStatus =
  | { kind: 'none' }
  | { kind: 'valid'; profile: ExtractedIccProfile }
  | { kind: 'invalid'; reason: string };

/**
 * Canonical colour interpretation of a raster source (import-side model;
 * maps 1:1 onto the scene `RasterColorEncoding` minus the profile registry
 * reference). `profile` carries the raw extracted ICC bytes when provenance
 * is 'embedded-icc'.
 */
export interface RasterEncodingInfo {
  model: RasterColorModel;
  primaries?: RgbPrimariesName;
  transfer?: TransferFunctionName;
  matrixCoefficients?: VideoMatrixCoefficients;
  videoRange?: VideoRange;
  bitDepth?: RasterPrecision;
  alphaMode?: RasterAlphaMode;
  provenance: RasterColorEncoding['provenance'];
  /** Raw embedded ICC bytes when the container carried a valid profile. */
  profile?: ExtractedIccProfile;
  /** Non-fatal diagnostics (conflicting metadata, degraded chunks). */
  diagnostics?: string[];
}

/** Complete normalized metadata of one ingested raster source. */
export interface ImageSourceMetadata {
  orientation: OrientationStatus;
  icc: SourceIccStatus;
  /** Canonical colour interpretation (see RasterEncodingInfo). */
  encoding: RasterEncodingInfo;
}

/**
 * Determine the canonical colour encoding of accepted raster bytes.
 * `mimeType` must come from content sniffing (`detectImageMime`).
 * Deterministic per-format precedence:
 *
 *   PNG:   iCCP > sRGB chunk > cHRM/gAMA > nothing
 *   JPEG:  APP2 ICC > EXIF ColorSpace > nothing
 *   WebP:  ICCP > nothing
 *   TIFF:  tag 34675 > photometric interpretation > nothing
 *   AVIF:  colr ICC > colr nclx CICP > nothing
 *
 * Conflicting metadata is never averaged: the higher-authority chunk wins
 * and the conflict is recorded in `diagnostics`.
 */
export function determineRasterEncoding(
  bytes: Uint8Array,
  mimeType: string,
  icc: IccExtractionResult,
): RasterEncodingInfo {
  switch (mimeType) {
    case 'image/png': {
      const encoding = resolvePngEncoding(bytes, icc);
      return toRasterEncodingInfo(encoding, icc);
    }
    case 'image/jpeg': {
      const encoding = resolveJpegEncoding(bytes, icc);
      return toRasterEncodingInfo(encoding, icc);
    }
    case 'image/webp': {
      const diagnostics: string[] = [];
      if (icc.kind === 'invalid') diagnostics.push(`embedded ICC profile invalid: ${icc.reason}`);
      const base: RasterColorEncoding =
        icc.kind === 'valid'
          ? {
              model: 'rgb',
              primaries: 'srgb',
              transfer: 'srgb',
              bitDepth: 8,
              alphaMode: 'straight',
              provenance: 'embedded-icc',
            }
          : {
              model: 'rgb',
              primaries: 'unknown',
              transfer: 'unknown',
              bitDepth: 8,
              alphaMode: 'straight',
              provenance: 'format-default',
            };
      return toRasterEncodingInfo(diagnostics.length > 0 ? { ...base, diagnostics } : base, icc);
    }
    case 'image/tiff': {
      const encoding = resolveTiffEncoding(bytes, icc);
      return toRasterEncodingInfo(encoding, icc);
    }
    case 'image/avif': {
      const { encoding, icc: avifIcc } = extractAvifColorMetadata(bytes);
      return toRasterEncodingInfo(encoding, avifIcc);
    }
    default:
      return {
        model: 'unknown',
        provenance: 'unknown',
        ...(icc.kind === 'valid' ? { profile: icc.profile } : {}),
      };
  }
}

/** Convert a scene-shaped encoding + ICC outcome into the import model. */
function toRasterEncodingInfo(
  encoding: RasterColorEncoding,
  icc: IccExtractionResult,
): RasterEncodingInfo {
  return {
    model: encoding.model,
    ...(encoding.primaries !== undefined ? { primaries: encoding.primaries } : {}),
    ...(encoding.transfer !== undefined ? { transfer: encoding.transfer } : {}),
    ...(encoding.matrixCoefficients !== undefined
      ? { matrixCoefficients: encoding.matrixCoefficients }
      : {}),
    ...(encoding.videoRange !== undefined ? { videoRange: encoding.videoRange } : {}),
    ...(encoding.bitDepth !== undefined ? { bitDepth: encoding.bitDepth } : {}),
    ...(encoding.alphaMode !== undefined ? { alphaMode: encoding.alphaMode } : {}),
    provenance: encoding.provenance,
    ...(icc.kind === 'valid' ? { profile: icc.profile } : {}),
    ...(encoding.diagnostics !== undefined && encoding.diagnostics.length > 0
      ? { diagnostics: encoding.diagnostics }
      : {}),
  };
}

/**
 * Extract orientation + ICC metadata + canonical colour encoding from
 * accepted raster bytes. `mimeType` must come from content sniffing
 * (`detectImageMime`). Never throws; every failure mode returns a typed
 * status.
 */
export function extractImageSourceMetadata(
  bytes: Uint8Array,
  mimeType: string,
): ImageSourceMetadata {
  const orientationValue = parseExifOrientation(bytes);
  const orientation: OrientationStatus =
    orientationValue === 1 ? { kind: 'none' } : { kind: 'oriented', orientation: orientationValue };

  // AVIF carries ICC inside the colr box rather than a container-level
  // chunk; the generic extractor has no AVIF case, so the AVIF scanner
  // supplies both the encoding AND the ICC outcome.
  const iccResult: IccExtractionResult =
    mimeType === 'image/avif'
      ? extractAvifColorMetadata(bytes).icc
      : extractIccProfile(bytes, mimeType);
  let icc: SourceIccStatus;
  switch (iccResult.kind) {
    case 'none':
      icc = { kind: 'none' };
      break;
    case 'valid':
      icc = { kind: 'valid', profile: iccResult.profile };
      break;
    case 'invalid':
      icc = { kind: 'invalid', reason: iccResult.reason };
      break;
  }

  return { orientation, icc, encoding: determineRasterEncoding(bytes, mimeType, iccResult) };
}

/**
 * Displayed (orientation-normalized) dimensions of a source.
 * Identical to the source dimensions when there is no orientation.
 */
export function displayedDimensions(
  width: number,
  height: number,
  metadata: ImageSourceMetadata,
): { width: number; height: number } {
  if (metadata.orientation.kind !== 'oriented') return { width, height };
  return orientedDimensions(width, height, metadata.orientation.orientation);
}

/**
 * Serialize an `ImageSourceMetadata` into the compact, forward-compatible
 * shape stored on a scene `DocumentAsset` (no raw bytes; ICC payloads live
 * in the document profile registry and are referenced by id). Produces the
 * scene `colorEncoding` block and the ICC profile bytes for registry
 * insertion.
 */
export function metadataToAssetModel(metadata: ImageSourceMetadata): {
  orientation?: ExifOrientation;
  iccStatus?: 'valid' | 'invalid' | 'none';
  iccDescription?: string;
  iccBytes?: Uint8Array;
  colorEncoding?: Omit<RasterColorEncoding, 'profileId'> & { profileId?: string };
} {
  const result: {
    orientation?: ExifOrientation;
    iccStatus?: 'valid' | 'invalid' | 'none';
    iccDescription?: string;
    iccBytes?: Uint8Array;
    colorEncoding?: Omit<RasterColorEncoding, 'profileId'> & { profileId?: string };
  } = {};
  if (metadata.orientation.kind === 'oriented') {
    result.orientation = metadata.orientation.orientation;
  }
  if (metadata.icc.kind === 'valid') {
    result.iccStatus = 'valid';
    result.iccBytes = metadata.icc.profile.bytes;
    if (metadata.icc.profile.description) result.iccDescription = metadata.icc.profile.description;
  } else if (metadata.icc.kind === 'invalid') {
    result.iccStatus = 'invalid';
  }

  const encoding = metadata.encoding;
  if (encoding) {
    const block: Omit<RasterColorEncoding, 'profileId'> & { profileId?: string } = {
      model: encoding.model,
      provenance: encoding.provenance,
    };
    if (encoding.primaries !== undefined) block.primaries = encoding.primaries;
    if (encoding.transfer !== undefined) block.transfer = encoding.transfer;
    if (encoding.matrixCoefficients !== undefined)
      block.matrixCoefficients = encoding.matrixCoefficients;
    if (encoding.videoRange !== undefined) block.videoRange = encoding.videoRange;
    if (encoding.bitDepth !== undefined) block.bitDepth = encoding.bitDepth;
    if (encoding.alphaMode !== undefined) block.alphaMode = encoding.alphaMode;
    if (encoding.diagnostics !== undefined && encoding.diagnostics.length > 0) {
      block.diagnostics = encoding.diagnostics;
    }
    result.colorEncoding = block;
  }
  return result;
}
