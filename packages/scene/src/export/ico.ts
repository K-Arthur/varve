/**
 * ICO icon container encoder (PNG-compressed entries, Vista+).
 *
 * Pure and deterministic: no DOM, no platform APIs. Each entry is a PNG
 * byte buffer; the container wraps them with an ICONDIR header and one
 * ICONDIRENTRY per image. Entries are sorted by pixel size ascending,
 * duplicates are dropped, and 256px maps to the 0x00 width/height byte.
 *
 * Produces valid multi-size .ico files for Windows favicons and app icons;
 * it is never a renamed PNG.
 */

export interface IcoEntry {
  /** Pixel size (square). Must be 1-256; 256 is stored as 0x00. */
  size: number;
  /** PNG-encoded image data (RGBA, transparent). */
  png: Uint8Array;
}

export const ICO_SUPPORTED_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256] as const;

export const ICO_MAX_ENTRIES = 16;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

export interface IcoValidation {
  ok: boolean;
  warnings: string[];
}

/** Validate raw ICO bytes structurally (header, entries, offsets, PNG data). */
export function validateIco(bytes: Uint8Array): IcoValidation {
  const warnings: string[] = [];
  if (bytes.length < 6) return { ok: false, warnings: ['File too short for an ICO header.'] };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reserved = view.getUint16(0, true);
  const type = view.getUint16(2, true);
  const count = view.getUint16(4, true);
  if (reserved !== 0) warnings.push('ICONDIR reserved field is not zero.');
  if (type !== 1) warnings.push('ICONDIR type is not 1 (icon).');
  if (count === 0 || count > ICO_MAX_ENTRIES) {
    return { ok: false, warnings: [`Invalid icon entry count: ${count}.`] };
  }
  const headerSize = 6 + count * 16;
  if (bytes.length < headerSize) {
    return { ok: false, warnings: ['File shorter than the entry directory.'] };
  }
  const seenSizes = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + i * 16;
    const widthByte = view.getUint8(offset);
    const heightByte = view.getUint8(offset + 1);
    const bytesInRes = view.getUint32(offset + 8, true);
    const imageOffset = view.getUint32(offset + 12, true);
    const size = widthByte === 0 ? 256 : widthByte;
    if (size !== (heightByte === 0 ? 256 : heightByte)) {
      warnings.push(`Entry ${i}: width/height mismatch (${size}/${heightByte}).`);
    }
    if (seenSizes.has(size)) warnings.push(`Duplicate size ${size}px in entry ${i}.`);
    seenSizes.add(size);
    if (imageOffset + bytesInRes > bytes.length) {
      return {
        ok: false,
        warnings: [`Entry ${i}: image range exceeds file bounds.`],
      };
    }
    const png = bytes.slice(imageOffset, imageOffset + bytesInRes);
    if (!isPng(png)) {
      return {
        ok: false,
        warnings: [`Entry ${i} (${size}px): payload is not a PNG.`],
      };
    }
    const view2 = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (png.length >= 16 && view2.getUint32(12) !== 0x49484452 /* IHDR */) {
      warnings.push(`Entry ${i}: PNG has no IHDR chunk.`);
    }
  }
  return { ok: warnings.length === 0, warnings };
}

export interface BuildIcoResult {
  bytes: Uint8Array;
  entries: number[];
  warnings: string[];
}

/**
 * Build an ICO container from PNG entries.
 * - Sizes are clamped to 1-256 and deduplicated (first occurrence wins).
 * - Entries are sorted ascending by size for deterministic output.
 * - 256px is encoded as 0x00 in width/height fields.
 */
export function buildIco(entries: IcoEntry[]): BuildIcoResult {
  const warnings: string[] = [];
  const seen = new Map<number, IcoEntry>();
  for (const entry of entries) {
    if (!isPng(entry.png)) {
      warnings.push(`Skipping ${entry.size}px entry: not a PNG.`);
      continue;
    }
    const size = Math.max(1, Math.min(256, Math.round(entry.size)));
    if (seen.has(size)) {
      warnings.push(`Skipping duplicate ${size}px entry.`);
      continue;
    }
    seen.set(size, entry);
  }
  const sorted = [...seen.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) {
    return { bytes: new Uint8Array(0), entries: [], warnings: ['No valid PNG entries provided.'] };
  }
  if (sorted.length > ICO_MAX_ENTRIES) {
    warnings.push(`Truncating to ${ICO_MAX_ENTRIES} entries.`);
    sorted.length = ICO_MAX_ENTRIES;
  }

  const headerSize = 6 + sorted.length * 16;
  const totalSize = headerSize + sorted.reduce((sum, [, entry]) => sum + entry.png.length, 0);
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, sorted.length, true); // count

  let cursor = headerSize;
  const sizes: number[] = [];
  sorted.forEach(([size, entry], index) => {
    const offset = 6 + index * 16;
    view.setUint8(offset, size === 256 ? 0 : size);
    view.setUint8(offset + 1, size === 256 ? 0 : size);
    view.setUint8(offset + 2, 0); // color count
    view.setUint8(offset + 3, 0); // reserved
    view.setUint16(offset + 4, 1, true); // planes
    view.setUint16(offset + 6, 32, true); // bit count
    view.setUint32(offset + 8, entry.png.length, true); // bytes in resource
    view.setUint32(offset + 12, cursor, true); // image offset
    bytes.set(entry.png, cursor);
    cursor += entry.png.length;
    sizes.push(size);
  });

  return { bytes, entries: sizes, warnings };
}
