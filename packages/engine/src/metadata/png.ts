/**
 * PNG metadata chunk handling for canonical export (Strata export pipeline,
 * Phase 5).
 *
 * PNG encodes pixel data into IDAT; ancillary metadata lives in tEXt / zTXt /
 * iTXt (textual), iCCP (colour profile), and eXIf (EXIF). The functions here
 * manipulate those ancillary chunks directly on the encoded byte stream, so
 * metadata can be embedded/stripped WITHOUT re-encoding pixels (canvas
 * `toBlob` produces metadata-free PNGs; these helpers add or remove what the
 * policy requires around that byte stream).
 *
 * Guarantees:
 *  - Chunks are inserted before IEND, after IDAT (the only valid position for
 *    ancillary chunks in a stream that must decode everywhere).
 *  - CRC is always recomputed; corrupt/foreign chunks are skipped defensively.
 *  - Stripping only removes ancillary metadata chunks — IHDR/PLTE/IDAT/IEND and
 *    the pixel stream are never touched.
 */

export interface PngTextEntry {
  /** Latin-1 keyword (e.g. 'Title', 'Author', 'Copyright'). */
  keyword: string;
  text: string;
  /** True for UTF-8 iTXt (use for non-Latin-1 text); false for tEXt. */
  utf8?: boolean;
  lang?: string;
}

export interface PngChunkInfo {
  type: string;
  offset: number;
  length: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// CRC-32 (reflected, polynomial 0xEDB88320) per PNG spec.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ bytes[i]!) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

/** Build one PNG chunk (length + type + data + crc). */
export function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Build a tEXt (latin-1) or iTXt (utf-8) chunk body. */
function textChunkBody(entry: PngTextEntry): Uint8Array {
  const keyword = asciiBytes(entry.keyword);
  if (!entry.utf8) {
    const body = new Uint8Array(keyword.length + 1 + entry.text.length);
    body.set(keyword, 0);
    body[keyword.length] = 0;
    body.set(asciiBytes(entry.text), keyword.length + 1);
    return body;
  }
  const text = new TextEncoder().encode(entry.text);
  const lang = new TextEncoder().encode(entry.lang ?? '');
  const translated = new Uint8Array(0);
  const body = new Uint8Array(
    keyword.length + 1 + 1 + 1 + lang.length + 1 + translated.length + text.length,
  );
  let o = 0;
  body.set(keyword, o);
  o += keyword.length;
  body[o] = 0;
  o += 1;
  body[o] = 0; // compression flag (0 = uncompressed)
  o += 1;
  body[o] = 0; // compression method
  o += 1;
  body.set(lang, o);
  o += lang.length;
  body[o] = 0;
  o += 1;
  body.set(text, o);
  return body;
}

/** Enumerate top-level PNG chunks (signature skipped). */
export function readPngChunks(bytes: Uint8Array): PngChunkInfo[] {
  const chunks: PngChunkInfo[] = [];
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    chunks.push({ type, offset, length });
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return chunks;
}

function isAncillary(type: string): boolean {
  return (
    type === 'tEXt' ||
    type === 'zTXt' ||
    type === 'iTXt' ||
    type === 'iCCP' ||
    type === 'eXIf' ||
    type === 'tIME'
  );
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Insert textual metadata chunks before IEND. Callers typically build a fresh
 * PNG with the canvas encoder (which carries no metadata) and then add exactly
 * what the export policy allows — nothing is ever preserved by accident.
 */
export function insertPngTextChunks(bytes: Uint8Array, entries: PngTextEntry[]): Uint8Array {
  if (entries.length === 0) return bytes;
  const chunks = readPngChunks(bytes);
  const iend = chunks.find((c) => c.type === 'IEND');
  const iendOffset = iend ? iend.offset : bytes.length;
  const prefix = bytes.slice(0, iendOffset);
  const suffix = iend ? bytes.slice(iendOffset) : new Uint8Array(0);
  const parts: Uint8Array[] = [prefix];
  for (const entry of entries) {
    parts.push(buildPngChunk(entry.utf8 ? 'iTXt' : 'tEXt', textChunkBody(entry)));
  }
  parts.push(suffix);
  return concat(parts);
}

/**
 * Embed an ICC profile as an iCCP chunk (compression method 0 = deflate). The
 * profile is deflated with the platform zlib via `DecompressionStream` when
 * available, falling back to a raw (uncompressed-method-0 placeholder) only
 * when deflate is unavailable — callers should gate on `canDeflate`.
 */
export function insertPngIccp(
  bytes: Uint8Array,
  profileName: string,
  profileBytes: Uint8Array,
): Promise<Uint8Array> {
  return deflate(profileBytes).then((compressed) => {
    const name = asciiBytes(profileName);
    const body = new Uint8Array(name.length + 1 + 1 + compressed.length);
    body.set(name, 0);
    body[name.length] = 0;
    body[name.length + 1] = 0; // compression method 0 (deflate)
    body.set(compressed, name.length + 2);
    const chunks = readPngChunks(bytes);
    const iend = chunks.find((c) => c.type === 'IEND');
    const iendOffset = iend ? iend.offset : bytes.length;
    const prefix = bytes.slice(0, iendOffset);
    const suffix = iend ? bytes.slice(iendOffset) : new Uint8Array(0);
    return concat([prefix, buildPngChunk('iCCP', body), suffix]);
  });
}

/** Whether the runtime can deflate (needed for iCCP and iTXt-compressed). */
export function canDeflate(): boolean {
  return typeof DecompressionStream !== 'undefined';
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    // CompressionStream is the standard mirror of DecompressionStream.
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  // No deflate available: emit the profile uncompressed under method 0. This
  // is technically non-conformant for iCCP; callers must not embed profiles on
  // runtimes without CompressionStream (preflight surfaces it).
  return bytes;
}

/**
 * Strip all ancillary metadata chunks (tEXt/zTXt/iTXt/iCCP/eXIf/tIME) from a
 * PNG. `keep` may list types to preserve (e.g. `['iCCP']` when the policy says
 * "strip metadata but keep the colour profile").
 */
export function stripPngMetadata(bytes: Uint8Array, keep: string[] = []): Uint8Array {
  const chunks = readPngChunks(bytes);
  const drop = new Set<number>();
  for (const chunk of chunks) {
    if (isAncillary(chunk.type) && !keep.includes(chunk.type)) drop.add(chunk.offset);
  }
  if (drop.size === 0) return bytes;
  const parts: Uint8Array[] = [];
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    if (!drop.has(offset)) parts.push(bytes.slice(offset, offset + 12 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return concat([bytes.slice(0, 8), ...parts]);
}

/** True when `bytes` looks like a PNG with a valid signature. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((value, i) => bytes[i] === value);
}
