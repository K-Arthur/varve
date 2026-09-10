/**
 * EXIF orientation handling for canonical export (Strata export pipeline,
 * Phase 5).
 *
 * The Orientation tag (EXIF tag 0x0112) tells viewers to rotate/flip the
 * stored pixels. For export we must apply the transform to pixels exactly once
 * and then never emit a non-identity orientation tag — otherwise the exported
 * file rotates a second time on reopen.
 *
 * `applyExifOrientation` returns the *new* orientation value a writer should
 * record (always 1 for JPEG; the pixel data is already transformed), so the
 * apply-once invariant is enforced by construction.
 */

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const VALID = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8]);

export function isValidExifOrientation(value: unknown): value is ExifOrientation {
  return typeof value === 'number' && Number.isInteger(value) && VALID.has(value);
}

/**
 * Parse the EXIF Orientation tag from a JPEG (or TIFF) byte stream.
 * - JPEG: finds the APP1 "Exif\0\0" segment, walks the TIFF IFD.
 * - TIFF: directly walks the IFD at the byte offset given by the header.
 * Returns 1 when the tag is absent or unreadable (orientation 1 = no transform).
 */
export function parseExifOrientation(bytes: Uint8Array): ExifOrientation {
  if (bytes.length < 8) return 1;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isTiff =
    (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d);
  if (!isJpeg && !isTiff) return 1;

  let tiffOffset = 0;
  if (isJpeg) {
    // Walk JPEG markers to the APP1 Exif segment.
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) return 1;
      const marker = bytes[offset + 1] as number;
      const segmentLength = (bytes[offset + 2] as number) * 256 + (bytes[offset + 3] as number);
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      if (segmentLength < 2) return 1;
      if (marker === 0xe1) {
        const isExif =
          bytes[offset + 4] === 0x45 &&
          bytes[offset + 5] === 0x78 &&
          bytes[offset + 6] === 0x69 &&
          bytes[offset + 7] === 0x66 &&
          bytes[offset + 8] === 0x00 &&
          bytes[offset + 9] === 0x00;
        if (isExif) {
          tiffOffset = offset + 10;
          break;
        }
      }
      offset += 2 + segmentLength;
    }
  } else {
    tiffOffset = 0;
  }

  return readOrientationFromTiff(bytes, tiffOffset);
}

function readOrientationFromTiff(bytes: Uint8Array, tiffOffset: number): ExifOrientation {
  if (tiffOffset + 8 > bytes.length) return 1;
  const littleEndian = bytes[tiffOffset] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const getU16 = (o: number): number => view.getUint16(o, littleEndian);
  const getU32 = (o: number): number => view.getUint32(o, littleEndian);

  const magic = getU16(tiffOffset + 2);
  if (magic !== 0x2a) return 1;
  const ifdOffset = tiffOffset + getU32(tiffOffset + 4);
  if (ifdOffset + 2 > bytes.length) return 1;
  const entryCount = getU16(ifdOffset);
  for (let i = 0; i < entryCount; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > bytes.length) break;
    if (getU16(entry) === 0x0112) {
      const value = getU16(entry + 8);
      return isValidExifOrientation(value) ? value : 1;
    }
  }
  return 1;
}

/**
 * Apply an EXIF orientation transform to decoded pixel data. Returns a new
 * ImageData; the caller records orientation as 1 afterwards.
 */
export function applyExifOrientation(image: ImageData, orientation: ExifOrientation): ImageData {
  if (orientation === 1) {
    return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  }
  const w = image.width;
  const h = image.height;
  const src = image.data;
  const swap = orientation >= 5;
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let dx = x;
      let dy = y;
      switch (orientation) {
        case 2:
          dx = w - 1 - x;
          break;
        case 3:
          dx = w - 1 - x;
          dy = h - 1 - y;
          break;
        case 4:
          dy = h - 1 - y;
          break;
        case 5:
          dx = y;
          dy = x;
          break;
        case 6:
          dx = h - 1 - y;
          dy = x;
          break;
        case 7:
          dx = h - 1 - y;
          dy = w - 1 - x;
          break;
        case 8:
          dx = y;
          dy = w - 1 - x;
          break;
      }
      const so = (y * w + x) * 4;
      const doff = (dy * outW + dx) * 4;
      out[doff] = src[so] as number;
      out[doff + 1] = src[so + 1] as number;
      out[doff + 2] = src[so + 2] as number;
      out[doff + 3] = src[so + 3] as number;
    }
  }
  return new ImageData(out, outW, outH);
}

/**
 * The orientation value to record after applying `applyExifOrientation` — the
 * pixels are already transformed, so the tag must be reset to 1 (no rotation).
 * Kept as an explicit function so callers cannot forget the apply-once rule.
 */
export function orientationAfterApply(): ExifOrientation {
  return 1;
}
