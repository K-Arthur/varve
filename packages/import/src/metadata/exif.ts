/**
 * Safe EXIF orientation extraction for raster ingestion.
 *
 * Reads the EXIF Orientation tag (0x0112) from JPEG (APP1 "Exif\0\0"
 * segment) or TIFF (main IFD, tag 274) byte streams without trusting any
 * offset. Every read is bounds-checked; IFD entry counts and offset chains
 * are capped so malformed or hostile files cannot drive unbounded parsing.
 *
 * Decode invariant (enforced by the render pipeline, see
 * docs/architecture/image-lifecycle.md): browser decoders
 * (HTMLImageElement, drawImage, createImageBitmap from an element) already
 * apply EXIF orientation, so Varve treats the *decoded* representation as
 * orientation-normalized and never applies the transform itself. This
 * parser exists so ingestion can record the stored orientation and compute
 * the *displayed* (oriented) dimensions for placement, crop, hit testing
 * and export geometry. Orientation 1 (or any parse failure) means no
 * transform — a single safe default, never a crash.
 */

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const ORIENTATION_VALUES: readonly ExifOrientation[] = [1, 2, 3, 4, 5, 6, 7, 8];

export function isValidExifOrientation(value: number): value is ExifOrientation {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}

/** Cap on IFD entries walked per directory. */
const MAX_IFD_ENTRIES = 512;
/** Cap on chained IFD pointers followed (ExifIFD pointer chain). */
const MAX_IFD_CHAIN = 8;
/** Cap on JPEG segments scanned looking for the Exif APP1 segment. */
const MAX_JPEG_SEGMENTS = 256;
/** Cap on a JPEG segment length; APP1 Exif payloads are small in practice. */
const MAX_JPEG_SEGMENT_BYTES = 64 * 1024 * 1024;

/** Bounds-checked big/little-endian readers. All reads return 0 on overrun. */
function makeReader(
  bytes: Uint8Array,
  littleEndian: boolean,
): { u16(o: number): number; u32(o: number): number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    u16: (o: number) => (o + 1 < bytes.length ? view.getUint16(o, littleEndian) : 0),
    u32: (o: number) => (o + 3 < bytes.length ? view.getUint32(o, littleEndian) : 0),
  };
}

/**
 * Read the EXIF Orientation tag from a TIFF structure starting at
 * `tiffOffset`. Walks IFD0, then (only if the tag is absent) the Exif
 * sub-IFD (0x8769) with a cycle guard. Returns 1 on any failure.
 */
function readOrientationFromTiff(bytes: Uint8Array, tiffOffset: number): ExifOrientation {
  if (tiffOffset < 0 || tiffOffset + 8 > bytes.length) return 1;
  const littleEndian = bytes[tiffOffset] === 0x49;
  const { u16, u32 } = makeReader(bytes, littleEndian);

  const magic = u16(tiffOffset + 2);
  if (magic !== 0x2a) return 1;

  const visited = new Set<number>();
  let ifdOffset = tiffOffset + u32(tiffOffset + 4);

  for (let chain = 0; chain < MAX_IFD_CHAIN; chain += 1) {
    if (!Number.isInteger(ifdOffset) || ifdOffset < tiffOffset || ifdOffset + 2 > bytes.length) {
      return 1;
    }
    if (visited.has(ifdOffset)) return 1; // cyclic IFD chain
    visited.add(ifdOffset);

    const entryCount = Math.min(u16(ifdOffset), MAX_IFD_ENTRIES);
    let exifIfdPointer: number | null = null;

    for (let i = 0; i < entryCount; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > bytes.length) break;
      const tag = u16(entry);
      const value = u16(entry + 8);
      if (tag === 0x0112) {
        if (isValidExifOrientation(value)) return value;
        return 1; // present but out of range — treat as malformed, not identity
      }
      if (tag === 0x8769) exifIfdPointer = u32(entry + 8);
    }

    if (exifIfdPointer === null) return 1;
    ifdOffset = tiffOffset + exifIfdPointer;
  }
  return 1;
}

/**
 * Parse the EXIF Orientation tag from JPEG or TIFF bytes.
 * Returns 1 (identity) when the tag is absent, unreadable, or malformed —
 * never throws for untrusted input.
 */
export function parseExifOrientation(bytes: Uint8Array): ExifOrientation {
  if (bytes.length < 4) return 1;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isTiff =
    (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d);
  if (!isJpeg && !isTiff) return 1;

  if (isTiff) return readOrientationFromTiff(bytes, 0);

  // Walk JPEG markers to the APP1 "Exif\0\0" segment.
  let offset = 2;
  for (let segments = 0; segments < MAX_JPEG_SEGMENTS; segments += 1) {
    if (offset + 4 > bytes.length) return 1;
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1] as number;
    // Standalone markers (no length field).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    if (segmentLength < 2) return 1;
    if (segmentLength > MAX_JPEG_SEGMENT_BYTES) return 1;
    const payloadEnd = offset + 2 + segmentLength;
    if (payloadEnd > bytes.length) return 1;

    if (marker === 0xe1) {
      const headerOk =
        offset + 10 <= payloadEnd &&
        bytes[offset + 4] === 0x45 &&
        bytes[offset + 5] === 0x78 &&
        bytes[offset + 6] === 0x69 &&
        bytes[offset + 7] === 0x66 &&
        bytes[offset + 8] === 0x00 &&
        bytes[offset + 9] === 0x00;
      if (headerOk) {
        return readOrientationFromTiff(bytes, offset + 10);
      }
    }
    // EOI or SOS: no more metadata segments follow.
    if (marker === 0xda || marker === 0xd9) return 1;
    offset = payloadEnd;
  }
  return 1;
}

/**
 * Read the EXIF ColorSpace tag (0xA001) from a JPEG APP1 "Exif\0\0"
 * segment (Exif sub-IFD). Returns the raw tag value, or undefined when
 * absent/unreadable. 1 = sRGB, 2 = Adobe RGB, 65535 = uncalibrated.
 * Never throws for untrusted input.
 */
export function parseExifColorSpace(bytes: Uint8Array): number | undefined {
  if (bytes.length < 4) return undefined;
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return undefined;

  let offset = 2;
  for (let segments = 0; segments < MAX_JPEG_SEGMENTS; segments += 1) {
    if (offset + 4 > bytes.length) return undefined;
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] as number;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    if (segmentLength < 2 || segmentLength > MAX_JPEG_SEGMENT_BYTES) return undefined;
    const payloadEnd = offset + 2 + segmentLength;
    if (payloadEnd > bytes.length) return undefined;

    if (marker === 0xe1) {
      const headerOk =
        offset + 10 <= payloadEnd &&
        bytes[offset + 4] === 0x45 &&
        bytes[offset + 5] === 0x78 &&
        bytes[offset + 6] === 0x69 &&
        bytes[offset + 7] === 0x66 &&
        bytes[offset + 8] === 0x00 &&
        bytes[offset + 9] === 0x00;
      if (headerOk) {
        const value = readExifSubTag(bytes, offset + 10, 0xa001);
        if (value !== undefined) return value;
      }
    }
    if (marker === 0xda || marker === 0xd9) return undefined;
    offset = payloadEnd;
  }
  return undefined;
}

/** Read a SHORT tag from the Exif sub-IFD (0x8769) of a TIFF structure. */
function readExifSubTag(bytes: Uint8Array, tiffOffset: number, wanted: number): number | undefined {
  if (tiffOffset < 0 || tiffOffset + 8 > bytes.length) return undefined;
  const littleEndian = bytes[tiffOffset] === 0x49;
  const { u16, u32 } = makeReader(bytes, littleEndian);
  if (u16(tiffOffset + 2) !== 0x2a) return undefined;

  const visited = new Set<number>();
  let ifdOffset = tiffOffset + u32(tiffOffset + 4);

  for (let chain = 0; chain < MAX_IFD_CHAIN; chain += 1) {
    if (!Number.isInteger(ifdOffset) || ifdOffset < tiffOffset || ifdOffset + 2 > bytes.length) {
      return undefined;
    }
    if (visited.has(ifdOffset)) return undefined;
    visited.add(ifdOffset);
    const entryCount = Math.min(u16(ifdOffset), MAX_IFD_ENTRIES);
    let exifIfdPointer: number | null = null;

    for (let i = 0; i < entryCount; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > bytes.length) break;
      const tag = u16(entry);
      if (tag === wanted && u16(entry + 2) === 3 /* SHORT */) {
        return u16(entry + 8);
      }
      if (tag === 0x8769) exifIfdPointer = u32(entry + 8);
    }

    if (exifIfdPointer === null) return undefined;
    ifdOffset = tiffOffset + exifIfdPointer;
  }
  return undefined;
}

/**
 * Displayed (oriented) dimensions of a source image. Orientations 5-8 swap
 * width and height. Callers that store a pixel width/height must use this
 * for the *displayed* size and keep the raw stored dimensions separately.
 */
export function orientedDimensions(
  width: number,
  height: number,
  orientation: ExifOrientation,
): { width: number; height: number } {
  const swap = orientation >= 5;
  return swap ? { width: height, height: width } : { width, height };
}
