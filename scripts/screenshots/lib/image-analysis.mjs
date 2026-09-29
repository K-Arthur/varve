/**
 * PNG integrity and content-plausibility analysis for the screenshot pipeline.
 *
 * A PNG signature plus an IHDR read (what the pipeline used to do) proves only
 * that a file *starts* like a PNG. A truncated file, a byte-flipped file that
 * keeps its dimensions and byte length, or a uniformly blank image all pass
 * that check. This module walks the real chunk stream, verifies every chunk
 * CRC, inflates the image data with zlib, and reports a bounded
 * content-plausibility signal.
 *
 * It is deliberately dependency-free and deterministic so both the Node
 * validator (`scripts/screenshots/validate.mjs`) and the browser-free Vitest
 * mirror can share one implementation instead of drifting apart.
 *
 * Scope: it can *reject* a corrupt or obviously blank file. It cannot certify
 * that an image shows the right thing — that still requires scene assertions
 * and human visual review.
 */
import { inflateSync } from 'node:zlib';

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** Standard PNG CRC-32 over an arbitrary byte range. */
export function crc32(buf, start = 0, end = buf.length) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const COLOR_TYPE_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Walk the chunk stream. Returns `null` when the bytes are not a PNG at all,
 * otherwise a report of every structural problem found.
 */
export function readPngChunks(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  for (let i = 0; i < 8; i += 1) {
    if (buf[i] !== PNG_SIGNATURE[i]) return null;
  }
  const chunks = [];
  const errors = [];
  let offset = 8;
  let truncated = false;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    // A declared length that runs past the buffer is the classic truncation
    // signature: the header claims a chunk the file does not contain.
    if (dataEnd + 4 > buf.length) {
      errors.push(`truncated chunk ${type} (declared ${length} byte(s))`);
      truncated = true;
      break;
    }
    const storedCrc = buf.readUInt32BE(dataEnd);
    const actualCrc = crc32(buf, offset + 4, dataEnd);
    if (storedCrc !== actualCrc) {
      errors.push(`bad CRC on chunk ${type}`);
    }
    chunks.push({ type, data: buf.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (offset !== buf.length && !truncated) {
    errors.push(`trailing bytes after final chunk (${buf.length - offset})`);
  }
  return { chunks, errors, truncated };
}

/**
 * Full structural + content analysis of one PNG buffer.
 *
 * `uniform` is a heuristic that flags a blank/near-blank image: it is set when
 * the inflated pixel stream contains almost no byte diversity. It can produce
 * a false negative on genuinely low-entropy artwork; it is used to *reject*
 * obviously broken captures, never to certify a good one.
 */
export function analysePng(buf, { minInflatedBytes = 10_000, maxDistinctBytes = 8 } = {}) {
  const result = {
    valid: false,
    width: 0,
    height: 0,
    bitDepth: 0,
    colorType: 0,
    channels: 0,
    chunkCount: 0,
    inflatedBytes: 0,
    distinctByteValues: 0,
    uniform: false,
    errors: [],
  };
  const parsed = readPngChunks(buf);
  if (!parsed) {
    result.errors.push('not a PNG (bad signature)');
    return result;
  }
  result.errors.push(...parsed.errors);
  result.chunkCount = parsed.chunks.length;

  const ihdr = parsed.chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) {
    result.errors.push('missing or short IHDR');
    return result;
  }
  if (parsed.chunks[0]?.type !== 'IHDR') result.errors.push('IHDR is not the first chunk');

  result.width = ihdr.data.readUInt32BE(0);
  result.height = ihdr.data.readUInt32BE(4);
  result.bitDepth = ihdr.data[8];
  result.colorType = ihdr.data[9];
  result.channels = COLOR_TYPE_CHANNELS[result.colorType] ?? 0;
  if (result.width === 0 || result.height === 0) result.errors.push('zero IHDR dimensions');
  const interlace = ihdr.data[12];
  if (interlace !== 0) result.errors.push('interlaced PNG is not supported by this check');
  if (result.channels === 0) result.errors.push(`unknown colour type ${result.colorType}`);
  if (!parsed.chunks.some((c) => c.type === 'IEND')) result.errors.push('missing IEND');

  const idat = Buffer.concat(parsed.chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  if (idat.length === 0) {
    result.errors.push('no IDAT data');
    return result;
  }
  let inflated;
  try {
    inflated = inflateSync(idat);
  } catch (err) {
    result.errors.push(`IDAT does not inflate: ${err instanceof Error ? err.message : err}`);
    return result;
  }
  result.inflatedBytes = inflated.length;
  const seen = new Uint8Array(256);
  let distinct = 0;
  for (const byte of inflated) {
    if (seen[byte] === 0) {
      seen[byte] = 1;
      distinct += 1;
    }
  }
  result.distinctByteValues = distinct;
  if (inflated.length >= minInflatedBytes && distinct <= maxDistinctBytes) {
    result.uniform = true;
    result.errors.push(
      `image looks blank/uniform (${distinct} distinct byte value(s) over ${inflated.length} inflated bytes)`,
    );
  }
  result.valid = result.errors.length === 0;
  return result;
}

/** Dimensions from the IHDR, or `null` when the bytes are not a PNG. */
export function pngDimensions(buf) {
  const parsed = readPngChunks(buf);
  if (!parsed) return null;
  const ihdr = parsed.chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 8) return null;
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) };
}

/** A byte-for-byte comparison that cannot be fooled by equal lengths. */
export function buffersEqual(a, b) {
  return a.length === b.length && a.equals(b);
}

/**
 * WebP dimensions from the container header.
 *
 * The pipeline writes WebP derivatives with the browser's own encoder, so this
 * only needs to read the three legal layouts rather than decode pixels:
 * lossless (`VP8L`), lossy (`VP8 `) and extended (`VP8X`).
 */
export function readWebpInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 30) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') {
    return null;
  }
  const declaredSize = buf.readUInt32LE(4) + 8;
  const fourCC = buf.toString('latin1', 12, 16);
  if (fourCC === 'VP8X') {
    if (buf.length < 30) return null;
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { format: 'webp', width, height, truncated: buf.length < declaredSize };
  }
  if (fourCC === 'VP8L') {
    if (buf.length < 25 || buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return {
      format: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      truncated: buf.length < declaredSize,
    };
  }
  if (fourCC === 'VP8 ') {
    if (buf.length < 30) return null;
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return {
      format: 'webp',
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
      truncated: buf.length < declaredSize,
    };
  }
  return null;
}

/**
 * Format-agnostic structural check for the two formats the pipeline emits.
 * PNG gets the full chunk/CRC/inflate treatment; WebP gets a container read.
 */
export function analyseImage(buf, options) {
  const png = readPngChunks(buf);
  if (png) {
    const result = analysePng(buf, options);
    return { ...result, format: 'png' };
  }
  const webp = readWebpInfo(buf);
  if (webp) {
    const errors = [];
    if (webp.width === 0 || webp.height === 0) errors.push('zero WebP dimensions');
    if (webp.truncated) errors.push('WebP container is shorter than its declared RIFF size');
    return {
      valid: errors.length === 0,
      format: 'webp',
      width: webp.width,
      height: webp.height,
      bitDepth: 0,
      colorType: 0,
      channels: 0,
      chunkCount: 0,
      inflatedBytes: 0,
      distinctByteValues: 0,
      uniform: false,
      errors,
    };
  }
  return {
    valid: false,
    format: null,
    width: 0,
    height: 0,
    bitDepth: 0,
    colorType: 0,
    channels: 0,
    chunkCount: 0,
    inflatedBytes: 0,
    distinctByteValues: 0,
    uniform: false,
    errors: ['not a PNG or WebP'],
  };
}
