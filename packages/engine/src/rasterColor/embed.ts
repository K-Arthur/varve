/**
 * ICC profile embedding into encoded raster output.
 *
 * PNG: iCCP chunk (existing writer in ./metadata/png.ts).
 * JPEG: chunked APP2 "ICC_PROFILE\0" segments right after SOI.
 * WebP: the container spec requires an extended VP8X chunk with the ICC
 *       flag when an ICCP chunk is present. Canvas encoders emit simple
 *       (non-extended) WebP, so profile embedding is NOT attempted —
 *       callers must disclose this rather than silently dropping profiles.
 *
 * All writers are post-processors on the encoded byte stream: pixels are
 * never re-encoded. Writers are deterministic and round-trip through
 * Varve's own extraction (tested in rasterColor tests).
 */

/** Max payload per JPEG APP2 segment (2-byte length field, minus headers). */
const JPEG_APP2_PAYLOAD = 65503; // 65519 - 12 (ICC_PROFILE\0) - 2 (seq/count)

const ICC_PROFILE_SIGNATURE = new Uint8Array([
  0x49,
  0x43,
  0x43,
  0x5f,
  0x50,
  0x52,
  0x4f,
  0x46,
  0x49,
  0x4c,
  0x45,
  0x00, // "ICC_PROFILE\0"
]);

/** Concatenate byte parts. */
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

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

/** Build one APP2 ICC segment (length field includes itself). */
function app2Segment(sequence: number, total: number, chunk: Uint8Array): Uint8Array {
  const body = new Uint8Array(14 + chunk.length);
  body.set(ICC_PROFILE_SIGNATURE, 0);
  body[12] = sequence;
  body[13] = total;
  body.set(chunk, 14);
  return concat([new Uint8Array([0xff, 0xe2]), u16(body.length + 2), body]);
}

/**
 * Embed an ICC profile into JPEG bytes as chunked APP2 segments inserted
 * immediately after SOI (the position JPEG readers scan first). Returns a
 * new byte stream; the input is untouched.
 */
export function insertJpegIccProfile(bytes: Uint8Array, profileBytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('not a JPEG byte stream (missing SOI)');
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < profileBytes.length; offset += JPEG_APP2_PAYLOAD) {
    chunks.push(profileBytes.subarray(offset, offset + JPEG_APP2_PAYLOAD));
  }
  const total = chunks.length;
  const segments = chunks.map((chunk, index) => app2Segment(index + 1, total, chunk));
  return concat([bytes.slice(0, 2), ...segments, bytes.slice(2)]);
}

/**
 * Whether the WebP encoder can embed profiles. Always false on this
 * pipeline: canvas WebP output is simple (non-extended) and adding ICCP
 * would require regenerating the file with an extended VP8X header.
 * Export/preflight must disclose this instead of claiming profile
 * preservation.
 */
export function webpProfileEmbeddingSupported(): boolean {
  return false;
}

/** True when the byte stream starts with the RIFF/WEBP magic. */
export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}
