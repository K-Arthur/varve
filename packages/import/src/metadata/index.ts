/**
 * Normalized source-image metadata for raster ingestion.
 *
 * Combines EXIF orientation and embedded ICC extraction into one small,
 * serializable model that scene assets can carry. Extraction is purely
 * metadata: no pixel data is decoded or transformed here.
 */

import { type ExifOrientation, orientedDimensions, parseExifOrientation } from './exif';
import { type ExtractedIccProfile, extractIccProfile } from './icc';

export {
  type ExifOrientation,
  isValidExifOrientation,
  orientedDimensions,
  parseExifOrientation,
} from './exif';
export type { ExtractedIccProfile, IccExtractionResult } from './icc';
export { extractIccProfile } from './icc';

/** Metadata outcome for a decoded orientation tag. */
export type OrientationStatus =
  | { kind: 'none' }
  | { kind: 'oriented'; orientation: ExifOrientation };

/** ICC outcome for an ingested image. */
export type SourceIccStatus =
  | { kind: 'none' }
  | { kind: 'valid'; profile: ExtractedIccProfile }
  | { kind: 'invalid'; reason: string };

/** Complete normalized metadata of one ingested raster source. */
export interface ImageSourceMetadata {
  orientation: OrientationStatus;
  icc: SourceIccStatus;
}

/**
 * Extract orientation + ICC metadata from accepted raster bytes.
 * `mimeType` must come from content sniffing (`detectImageMime`).
 * Never throws; every failure mode returns a typed status.
 */
export function extractImageSourceMetadata(
  bytes: Uint8Array,
  mimeType: string,
): ImageSourceMetadata {
  const orientationValue = parseExifOrientation(bytes);
  const orientation: OrientationStatus =
    orientationValue === 1 ? { kind: 'none' } : { kind: 'oriented', orientation: orientationValue };

  const iccResult = extractIccProfile(bytes, mimeType);
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

  return { orientation, icc };
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
 * in the document profile registry and are referenced by id).
 */
export function metadataToAssetModel(metadata: ImageSourceMetadata): {
  orientation?: ExifOrientation;
  iccStatus?: 'valid' | 'invalid' | 'none';
  iccDescription?: string;
  iccBytes?: Uint8Array;
} {
  const result: {
    orientation?: ExifOrientation;
    iccStatus?: 'valid' | 'invalid' | 'none';
    iccDescription?: string;
    iccBytes?: Uint8Array;
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
  return result;
}
