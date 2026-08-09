/**
 * Deterministic binary fixtures for EXIF/ICC ingestion tests.
 *
 * These builders produce real byte streams (not mocks): JPEG segment
 * framing, TIFF IFD layout with both endiannesses, PNG chunked structure
 * with CRCs, and RIFF/WebP chunk framing. Malformed variants are derived
 * by corrupting the valid fixtures at exact offsets, so the parsers are
 * exercised against the same byte layout real files use.
 */
import { deflateSync } from 'fflate';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard IEEE CRC-32 (PNG chunk check value). */
function crc32(data: Uint8Array, seed = 0xffffffff): number {
  let c = seed;
  for (const byte of data) {
    c = CRC32_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ── ICC profile ──────────────────────────────────────────────────────────────

/** Minimal structurally valid ICC profile (size + acsp signature). */
export function buildMinimalIccProfile(size = 128, description?: string): Uint8Array {
  const body = description
    ? new TextEncoder().encode(description.slice(0, 255))
    : new Uint8Array(0);
  const total = Math.max(size, 148 + body.length);
  const profile = new Uint8Array(total);
  const view = new DataView(profile.buffer);
  view.setUint32(0, total, false);
  profile[36] = 0x61;
  profile[37] = 0x63;
  profile[38] = 0x73;
  profile[39] = 0x70;
  if (description) {
    // desc tag table entry pointing at a 12-byte 'desc' header + ASCII payload.
    profile[132] = 0x64;
    profile[133] = 0x65;
    profile[134] = 0x73;
    profile[135] = 0x63;
    view.setUint32(140, 12, false); // size of 'desc' type header
    view.setUint32(144, body.length, false); // ASCII count
    profile.set(body, 148);
  }
  return profile;
}

// ── TIFF ─────────────────────────────────────────────────────────────────────

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Raw value bytes (or 4-byte inline value). */
  value: Uint8Array | number;
}
/**
 * Build a TIFF file with one IFD containing the given entries. Out-of-line
 * values (Uint8Array) are appended after the IFD and referenced by offset.
 */
export function buildTiff(
  entries: TiffEntry[],
  littleEndian = true,
  extraOffsetData?: (base: number) => Uint8Array,
  ifdOffsetOverride?: number,
): Uint8Array {
  const headerLength = 8;
  const ifdLength = 2 + entries.length * 12 + 4;
  const payloadStart = headerLength + ifdLength;
  const payloads: Uint8Array[] = [];
  let payloadCursor = payloadStart;
  for (const entry of entries) {
    if (typeof entry.value !== 'number') {
      entry.value = entry.value as Uint8Array;
      payloads.push(entry.value);
      payloadCursor += entry.value.length;
    }
  }
  const extra = extraOffsetData ? extraOffsetData(payloadCursor) : new Uint8Array(0);
  const total = payloadCursor + extra.length;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  bytes[0] = littleEndian ? 0x49 : 0x4d;
  bytes[1] = littleEndian ? 0x49 : 0x4d;
  view.setUint16(2, 0x2a, littleEndian);
  view.setUint32(4, ifdOffsetOverride ?? 8, littleEndian);

  const ifdOffset = headerLength;
  view.setUint16(ifdOffset, entries.length, littleEndian);
  let cursor = ifdOffset + 2;
  let nextPayload = payloadStart;
  for (const entry of entries) {
    view.setUint16(cursor, entry.tag, littleEndian);
    view.setUint16(cursor + 2, entry.type, littleEndian);
    view.setUint32(cursor + 4, entry.count, littleEndian);
    if (typeof entry.value === 'number') {
      // SHORT/INT values live in the low bytes of the 4-byte slot in the
      // TIFF's own byte order (bytes 06 00 xx xx for LE, xx xx 00 06 for BE).
      view.setUint16(cursor + 8, entry.value, littleEndian);
    } else {
      view.setUint32(cursor + 8, nextPayload, littleEndian);
      bytes.set(entry.value, nextPayload);
      nextPayload += entry.value.length;
    }
    cursor += 12;
  }
  view.setUint32(cursor, 0, littleEndian); // next IFD = 0
  bytes.set(extra, payloadCursor);
  return bytes;
}

/** TIFF containing an EXIF Orientation tag (value is a SHORT, type 3). */
export function buildTiffWithOrientation(orientation: number, littleEndian = true): Uint8Array {
  return buildTiff([{ tag: 0x0112, type: 3, count: 1, value: orientation }], littleEndian);
}

/** TIFF containing an ICC profile tag (type UNDEFINED = 7). */
export function buildTiffWithIcc(profile: Uint8Array, littleEndian = true): Uint8Array {
  return buildTiff([{ tag: 0x876f, type: 7, count: profile.length, value: profile }], littleEndian);
}

/** TIFF whose IFD pointer points past the end of the file. */
export function buildCorruptTiffOffset(): Uint8Array {
  const bytes = buildTiff([{ tag: 0x0112, type: 3, count: 1, value: 6 }], true);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 0x7fffffff, true); // IFD offset far beyond EOF
  return bytes;
}

/** TIFF whose IFD entry count claims 65,535 entries (way over the cap). */
export function buildTiffEntryCountBomb(): Uint8Array {
  const bytes = buildTiff(
    [{ tag: 0x0100, type: 4, count: 1, value: 400 }], // ImageWidth, no orientation
    true,
  );
  const view = new DataView(bytes.buffer);
  view.setUint16(8, 0xffff, true); // entry count at IFD start
  return bytes;
}

// ── JPEG ─────────────────────────────────────────────────────────────────────

/**
 * Build a JPEG with an APP1 Exif segment. `orientation` is written into
 * the Exif TIFF (little- or big-endian). SOS marker terminates the scan
 * so the parser stops at the same point real files do.
 */
export function buildJpegWithExifOrientation(
  orientation: number,
  littleEndian = true,
  corruptHeader = false,
): Uint8Array {
  const tiff = buildTiff([{ tag: 0x0112, type: 3, count: 1, value: orientation }], littleEndian);
  const exifPayload = new Uint8Array(6 + tiff.length);
  exifPayload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
  exifPayload.set(tiff, 6);

  const segmentLength = exifPayload.length + 2;
  const app1 = new Uint8Array(2 + segmentLength);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (segmentLength >> 8) & 0xff;
  app1[3] = segmentLength & 0xff;
  app1.set(exifPayload, 4);
  if (corruptHeader) {
    app1[4] = 0x00; // break "Exif\0\0" signature (after payload placement)
  }

  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const out = new Uint8Array(2 + app1.length + sos.length);
  out[0] = 0xff;
  out[1] = 0xd8; // SOI
  out.set(app1, 2);
  out.set(sos, 2 + app1.length);
  return out;
}

/** Build a JPEG with a sequence of APP2 ICC chunks. */
export function buildJpegWithIccChunks(profile: Uint8Array, chunkSize = 40): Uint8Array {
  const totalChunks = Math.ceil(profile.length / chunkSize);
  const chunks: Uint8Array[] = [];
  for (let seq = 1; seq <= totalChunks; seq += 1) {
    const start = (seq - 1) * chunkSize;
    const end = Math.min(profile.length, start + chunkSize);
    const payload = profile.subarray(start, end);
    const body = new Uint8Array(14 + payload.length);
    body.set([0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00], 0);
    body[12] = seq;
    body[13] = totalChunks;
    body.set(payload, 14);
    const segmentLength = body.length + 2;
    const chunk = new Uint8Array(2 + segmentLength);
    chunk[0] = 0xff;
    chunk[1] = 0xe2;
    chunk[2] = (segmentLength >> 8) & 0xff;
    chunk[3] = segmentLength & 0xff;
    chunk.set(body, 4);
    chunks.push(chunk);
  }

  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const total = 2 + chunks.reduce((s, c) => s + c.length, 0) + sos.length;
  const out = new Uint8Array(total);
  out[0] = 0xff;
  out[1] = 0xd8;
  let o = 2;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  out.set(sos, o);
  return out;
}

// ── PNG ──────────────────────────────────────────────────────────────────────

function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  typeBytes.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function minimalPngChunks(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1, false);
  ihdrView.setUint32(4, 1, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return concat(
    PNG_SIGNATURE,
    buildPngChunk('IHDR', ihdr),
    buildPngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    buildPngChunk('IEND', new Uint8Array(0)),
  );
}

export function buildPngWithIccp(profile: Uint8Array): Uint8Array {
  const deflated = deflateSync(profile);
  const name = new Uint8Array([
    0x49, 0x43, 0x43, 0x20, 0x70, 0x72, 0x6f, 0x66, 0x69, 0x6c, 0x65, 0x00,
  ]);
  const body = concat(name, new Uint8Array([0]), deflated);
  const base = minimalPngChunks();
  return concat(
    base.subarray(0, 8 + 8 + 13 + 4), // signature + IHDR chunk
    buildPngChunk('iCCP', body),
    base.subarray(8 + 8 + 13 + 4),
  );
}

export function buildPngWithoutIccp(): Uint8Array {
  return minimalPngChunks();
}

/** Truncate a PNG mid-iCCP payload (bad CRC / short data). */
export function truncatePng(bytes: Uint8Array, newLength: number): Uint8Array {
  return bytes.subarray(0, newLength);
}

// ── WebP ─────────────────────────────────────────────────────────────────────

export function buildWebpWithIccp(profile: Uint8Array): Uint8Array {
  const iccpPayload = new Uint8Array(profile.length + (profile.length % 2 === 1 ? 1 : 0));
  iccpPayload.set(profile, 0);
  const iccp = new Uint8Array(8 + iccpPayload.length);
  iccp.set([0x49, 0x43, 0x43, 0x50], 0); // "ICCP"
  new DataView(iccp.buffer).setUint32(4, iccpPayload.length, true);
  iccp.set(iccpPayload, 8);

  // Minimal VP8 keyframe chunk carrying a 1x1 lossy image header.
  const vp8 = new Uint8Array([
    0x56, 0x50, 0x38, 0x20, 0x00, 0x00, 0x00, 0x0a, 0x9d, 0x01, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ]);
  new DataView(vp8.buffer).setUint32(4, vp8.length - 8, true);

  const payload = concat(iccp, vp8);
  const riff = new Uint8Array(12 + payload.length);
  riff.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  new DataView(riff.buffer).setUint32(4, 4 + payload.length, true);
  riff.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  riff.set(payload, 12);
  return riff;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
