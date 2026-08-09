/**
 * Embedded ICC profile extraction for raster ingestion.
 *
 * Supports the containers Varve accepts for live decoding:
 * - JPEG: chunked APP2 "ICC_PROFILE\0" segments (sequence-numbered).
 * - PNG: iCCP chunk (deflate-compressed profile; inflated via fflate).
 * - WebP: RIFF "ICCP" chunk (uncompressed per the WebP container spec).
 * - TIFF: tag 34675 (ICC_Profile, type UNDEFINED) in any IFD.
 *
 * Every parser is bounds-checked and budget-capped so malformed or hostile
 * metadata cannot drive unbounded allocation. Invalid profiles are reported
 * explicitly (`invalid` with a reason) rather than reinterpreted as a
 * different profile — ingestion records the outcome so print/preflight can
 * warn instead of silently mis-colour-managing.
 *
 * Extraction is metadata-only: no pixels are transformed at ingestion.
 * Colour conversion through the working space is a separate stage (see
 * docs/architecture/image-lifecycle.md).
 */

import { inflateSync } from 'fflate';

/** Hard cap on accepted profile size (real ICC profiles are usually < 1 MiB). */
export const MAX_ICC_BYTES = 16 * 1024 * 1024;

/** A complete, structurally valid embedded ICC profile. */
export interface ExtractedIccProfile {
  /** Raw profile bytes (start of the profile header onward). */
  bytes: Uint8Array;
  /** Human-readable profile description tag, when present and ASCII-printable. */
  description?: string;
  /** ICC profile class signature (e.g. 'mntr' display class). */
  profileClass?: string;
  /** ICC colour space signature (e.g. 'RGB ', 'CMYK', 'GRAY', 'Lab '). */
  colorSpace?: string;
  /** ICC version, e.g. '4.3.0'. */
  version?: string;
  /** ICC header rendering intent (0-3: perceptual/relative/saturation/absolute). */
  renderingIntent?: number;
}

/** Human-readable label for an ICC profile class signature. */
export function iccProfileClassLabel(signature: string | undefined): string | undefined {
  switch (signature) {
    case 'scnr':
      return 'input device';
    case 'mntr':
      return 'display device';
    case 'prtr':
      return 'output device';
    case 'link':
      return 'device link';
    case 'abst':
      return 'abstract';
    case 'spac':
      return 'colour space';
    case 'nmcl':
      return 'named colour';
    case 'cenc':
      return 'colour encoding space';
    case 'mlnk':
      return 'multi-localized link';
    case 'mAB ':
    case 'mBA ':
      return 'abstract (mAB/mBA)';
    default:
      return undefined;
  }
}

/** Human-readable label for an ICC colour space signature. */
export function iccColorSpaceLabel(signature: string | undefined): string | undefined {
  switch (signature) {
    case 'RGB ':
      return 'RGB';
    case 'CMYK':
      return 'CMYK';
    case 'GRAY':
      return 'grayscale';
    case 'Lab ':
      return 'Lab';
    case 'XYZ ':
      return 'XYZ';
    case 'Luv ':
      return 'Luv';
    case 'YCbr':
      return 'YCbCr';
    default:
      return undefined;
  }
}

export type IccExtractionResult =
  | { kind: 'none' }
  | { kind: 'valid'; profile: ExtractedIccProfile }
  | { kind: 'invalid'; reason: string };

/**
 * Structural header validation. An ICC profile starts with a 128-byte
 * header whose first four bytes are the big-endian profile size and whose
 * bytes 36-39 hold the "acsp" signature.
 */
export function isValidIccProfile(bytes: Uint8Array): boolean {
  if (bytes.length < 128) return false;
  if (bytes[0] !== 0 || bytes[1] !== 0) return false; // profile size is a u32; top bytes must be 0
  if (bytes[36] !== 0x61 || bytes[37] !== 0x63 || bytes[38] !== 0x73 || bytes[39] !== 0x70) {
    return false; // "acsp"
  }
  const declaredSize = readUint32BE(bytes, 0);
  if (declaredSize < 128 || declaredSize > MAX_ICC_BYTES) return false;
  // Tolerate trailing container padding (declaredSize <= provided length).
  return declaredSize <= bytes.length;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 >= bytes.length) return 0;
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  );
}

/** Parse the ICC "desc" tag (text description, tag type 'desc') for a label.
 *  Layout: 4-byte type + 4-byte reserved + 4-byte ASCII count + text + NUL. */
function profileDescription(bytes: Uint8Array): string | undefined {
  // The desc tag type is a 12-byte header; the ASCII count follows at 8.
  for (let offset = 128; offset + 12 <= bytes.length; offset += 4) {
    const tag = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
    if (tag !== 'desc') continue;
    const count = readUint32BE(bytes, offset + 8);
    if (!Number.isInteger(count) || count <= 0 || count > 255) return undefined;
    const start = offset + 12;
    if (start + count > bytes.length) return undefined;
    const chars = new Array<string>(count);
    for (let i = 0; i < count; i += 1) {
      const c = bytes[start + i] as number;
      if (c === 0 || c > 0x7e) return undefined;
      chars[i] = String.fromCharCode(c);
    }
    const label = chars.join('').trim();
    return label.length > 0 ? label : undefined;
  }
  return undefined;
}

/**
 * Parse the fixed ICC header fields (version, class, colour space, rendering
 * intent). Header-only: no tag table walking, no allocation beyond the
 * description. Returns undefined values for unreadable fields; never throws.
 */
export function parseIccProfileHeader(bytes: Uint8Array): {
  profileClass?: string;
  colorSpace?: string;
  version?: string;
  renderingIntent?: number;
} {
  if (bytes.length < 128) return {};
  const className = String.fromCharCode(
    bytes[12] ?? 0x20,
    bytes[13] ?? 0x20,
    bytes[14] ?? 0x20,
    bytes[15] ?? 0x20,
  );
  const colorSpaceName = String.fromCharCode(
    bytes[16] ?? 0x20,
    bytes[17] ?? 0x20,
    bytes[18] ?? 0x20,
    bytes[19] ?? 0x20,
  );
  // Only claim a signature when every byte is printable ASCII; NUL-filled
  // headers (minimal fixtures, malformed files) must not fabricate one.
  const isPrintable = (sig: string): boolean => {
    for (let i = 0; i < sig.length; i += 1) {
      const code = sig.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) return false;
    }
    return true;
  };
  // Version: byte 0 major, byte 1 high nibble minor / low nibble bugfix.
  const major = bytes[8] ?? 0;
  const minor = ((bytes[9] ?? 0) >> 4) & 0x0f;
  const bugfix = (bytes[9] ?? 0) & 0x0f;
  const intent = readUint32BE(bytes, 64);
  return {
    ...(isPrintable(className) ? { profileClass: className } : {}),
    ...(isPrintable(colorSpaceName) ? { colorSpace: colorSpaceName } : {}),
    ...(major > 0 ? { version: `${major}.${minor}.${bugfix}` } : {}),
    ...(Number.isInteger(intent) && intent <= 3 ? { renderingIntent: intent } : {}),
  };
}

/** Build an ExtractedIccProfile from validated bytes (header info included). */
export function profileFromBytes(bytes: Uint8Array): ExtractedIccProfile {
  return {
    bytes,
    description: profileDescription(bytes),
    ...parseIccProfileHeader(bytes),
  };
}

/** Bounds-checked reader for little/big-endian TIFF walks. */
interface TiffReader {
  u16(o: number): number;
  u32(o: number): number;
}

function tiffReader(bytes: Uint8Array, littleEndian: boolean): TiffReader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    u16: (o: number) => (o + 1 < bytes.length ? view.getUint16(o, littleEndian) : 0),
    u32: (o: number) => (o + 3 < bytes.length ? view.getUint32(o, littleEndian) : 0),
  };
}

/** Bounds-checked TIFF IFD walker. `visit` receives every entry; walking is
 *  chain-capped and cycle-guarded (shared by ICC and TIFF encoding readers). */
export function walkTiffIfds(
  bytes: Uint8Array,
  tiffOffset: number,
  visit: (
    tag: number,
    type: number,
    count: number,
    valueOffset: number,
    readU32: (offset: number) => number,
  ) => void,
): void {
  if (tiffOffset + 8 > bytes.length) return;
  const { u16, u32 } = tiffReader(bytes, bytes[tiffOffset] === 0x49);
  const visited = new Set<number>();
  let ifdOffset = tiffOffset + u32(tiffOffset + 4);

  for (let chain = 0; chain < 16; chain += 1) {
    if (ifdOffset < tiffOffset || ifdOffset + 2 > bytes.length) return;
    if (visited.has(ifdOffset)) return;
    visited.add(ifdOffset);
    const entryCount = Math.min(u16(ifdOffset), 512);
    for (let i = 0; i < entryCount; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > bytes.length) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const count = u32(entry + 4);
      visit(tag, type, count, entry + 8, u32);
    }
    const next = u32(ifdOffset + 2 + entryCount * 12);
    if (next === 0) return;
    ifdOffset = tiffOffset + next;
  }
}

// ── Format parsers ───────────────────────────────────────────────────────────

/** JPEG APP2 chunked ICC profile reconstruction. */
function extractIccFromJpeg(bytes: Uint8Array): IccExtractionResult {
  const chunks = new Map<number, Uint8Array>();
  let declaredCount = 0;
  let offset = 2;
  let totalBytes = 0;

  for (let segments = 0; segments < 256; segments += 1) {
    if (offset + 4 > bytes.length) break;
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] as number;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    if (segmentLength < 2) break;
    const payloadEnd = offset + 2 + segmentLength;
    if (payloadEnd > bytes.length) break;

    if (marker === 0xe2 && payloadEnd >= offset + 16) {
      const isIcc =
        bytes[offset + 4] === 0x49 &&
        bytes[offset + 5] === 0x43 &&
        bytes[offset + 6] === 0x43 &&
        bytes[offset + 7] === 0x5f &&
        bytes[offset + 8] === 0x50 &&
        bytes[offset + 9] === 0x52 &&
        bytes[offset + 10] === 0x4f &&
        bytes[offset + 11] === 0x46 &&
        bytes[offset + 12] === 0x49 &&
        bytes[offset + 13] === 0x4c &&
        bytes[offset + 14] === 0x45 &&
        bytes[offset + 15] === 0x00; // "ICC_PROFILE\0"
      if (isIcc) {
        const seq = bytes[offset + 16] as number;
        const total = bytes[offset + 17] as number;
        if (seq < 1 || total < 1 || total > 255 || seq > total) {
          return { kind: 'invalid', reason: 'malformed ICC chunk sequence header' };
        }
        if (declaredCount === 0) declaredCount = total;
        if (total !== declaredCount) {
          return { kind: 'invalid', reason: 'inconsistent ICC chunk count' };
        }
        if (chunks.has(seq)) return { kind: 'invalid', reason: 'duplicate ICC chunk' };
        const chunk = bytes.subarray(offset + 18, payloadEnd);
        totalBytes += chunk.length;
        if (totalBytes > MAX_ICC_BYTES) {
          return { kind: 'invalid', reason: `ICC profile exceeds ${MAX_ICC_BYTES} bytes` };
        }
        chunks.set(seq, chunk);
      }
    }
    if (marker === 0xda || marker === 0xd9) break;
    offset = payloadEnd;
  }

  if (chunks.size === 0) return { kind: 'none' };
  if (chunks.size !== declaredCount) {
    return { kind: 'invalid', reason: 'incomplete ICC chunk sequence' };
  }

  const profile = new Uint8Array(totalBytes);
  let written = 0;
  for (let seq = 1; seq <= declaredCount; seq += 1) {
    const chunk = chunks.get(seq);
    if (!chunk) return { kind: 'invalid', reason: 'missing ICC chunk' };
    profile.set(chunk, written);
    written += chunk.length;
  }

  if (!isValidIccProfile(profile)) {
    return { kind: 'invalid', reason: 'invalid ICC profile header' };
  }
  return { kind: 'valid', profile: profileFromBytes(profile) };
}

/** PNG iCCP chunk (profile name\0, compression method byte, deflate payload). */
function extractIccFromPng(bytes: Uint8Array): IccExtractionResult {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) return { kind: 'invalid', reason: 'truncated PNG chunk' };

    if (type === 'iCCP') {
      let nameEnd = dataStart;
      const nameLimit = Math.min(dataEnd, dataStart + 79);
      while (nameEnd < nameLimit && bytes[nameEnd] !== 0) nameEnd += 1;
      if (nameEnd >= nameLimit)
        return { kind: 'invalid', reason: 'iCCP profile name unterminated' };
      if (nameEnd + 1 >= dataEnd)
        return { kind: 'invalid', reason: 'iCCP missing compression byte' };
      if (bytes[nameEnd + 1] !== 0) {
        return { kind: 'invalid', reason: 'unsupported iCCP compression method' };
      }
      const deflated = bytes.subarray(nameEnd + 2, dataEnd);
      let profile: Uint8Array;
      try {
        // Bounded inflate: fflate errors when the stream exceeds `out`.
        profile = inflateSync(deflated, { out: new Uint8Array(MAX_ICC_BYTES + 1) });
      } catch {
        return { kind: 'invalid', reason: 'iCCP inflate failed' };
      }
      if (profile.length > MAX_ICC_BYTES || !isValidIccProfile(profile)) {
        return { kind: 'invalid', reason: 'invalid ICC profile header' };
      }
      return {
        kind: 'valid',
        profile: profileFromBytes(profile),
      };
    }
    offset = dataEnd + 4; // skip CRC
  }
  return { kind: 'none' };
}

/** WebP "ICCP" chunk (uncompressed ICC profile per the container spec). */
function extractIccFromWebp(bytes: Uint8Array): IccExtractionResult {
  if (bytes.length < 12) return { kind: 'none' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12; // RIFF header + WEBP magic
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
    let size = view.getUint32(offset + 4, true);
    // Chunk sizes are even-padded; reject absurd values before allocation.
    if (size > MAX_ICC_BYTES) return { kind: 'invalid', reason: 'ICCP chunk too large' };
    const dataStart = offset + 8;
    if (dataStart + size > bytes.length) return { kind: 'invalid', reason: 'truncated WebP ICCP' };
    if (fourcc === 'ICCP') {
      const profile = bytes.subarray(dataStart, dataStart + size);
      if (size > 0 && size % 2 === 1) size += 1; // pad parity check (spec: padded to even)
      if (!isValidIccProfile(profile)) {
        return { kind: 'invalid', reason: 'invalid ICC profile header' };
      }
      return {
        kind: 'valid',
        profile: profileFromBytes(profile),
      };
    }
    if (size % 2 === 1) size += 1;
    offset = dataStart + size;
    if (size === 0) break; // zero-size chunk: stop walking
  }
  return { kind: 'none' };
}

/** TIFF tag 34675 (ICC_Profile). */
function extractIccFromTiff(bytes: Uint8Array): IccExtractionResult {
  let result: IccExtractionResult = { kind: 'none' };
  walkTiffIfds(bytes, 0, (tag, type, count, valueSlot, readU32) => {
    if (tag !== 0x876f /* 34675 */ || result.kind !== 'none') return;
    if (type !== 7 /* UNDEFINED */ && type !== 1 /* BYTE */) {
      result = { kind: 'invalid', reason: 'unsupported ICC tag type' };
      return;
    }
    if (!Number.isInteger(count) || count < 128 || count > MAX_ICC_BYTES) {
      result = { kind: 'invalid', reason: 'implausible ICC profile size' };
      return;
    }
    // Values larger than 4 bytes are referenced by offset in the slot;
    // smaller values are inline (irrelevant here given count >= 128).
    const valueOffset = count <= 4 ? valueSlot : readU32(valueSlot);
    if (!Number.isInteger(valueOffset) || valueOffset + count > bytes.length) {
      result = { kind: 'invalid', reason: 'truncated TIFF ICC profile' };
      return;
    }
    const profile = bytes.subarray(valueOffset, valueOffset + count);
    if (profile.length !== count) {
      result = { kind: 'invalid', reason: 'truncated TIFF ICC profile' };
      return;
    }
    if (!isValidIccProfile(profile)) {
      result = { kind: 'invalid', reason: 'invalid ICC profile header' };
      return;
    }
    result = {
      kind: 'valid',
      profile: profileFromBytes(profile),
    };
  });
  return result;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Extract the embedded ICC profile from an accepted raster byte stream.
 * `mimeType` must come from `detectImageMime` (content-sniffed, never from
 * the extension or filename). Returns a typed outcome; never throws.
 */
export function extractIccProfile(bytes: Uint8Array, mimeType: string): IccExtractionResult {
  try {
    switch (mimeType) {
      case 'image/jpeg':
        return extractIccFromJpeg(bytes);
      case 'image/png':
        return extractIccFromPng(bytes);
      case 'image/webp':
        return extractIccFromWebp(bytes);
      case 'image/tiff':
        return extractIccFromTiff(bytes);
      default:
        return { kind: 'none' };
    }
  } catch {
    // Malformed containers must never crash ingestion.
    return { kind: 'invalid', reason: 'metadata parse failed' };
  }
}
