/**
 * PNG pHYs chunk injection and round-trip support.
 *
 * Writes real physical-resolution metadata into PNG byte streams produced
 * by canvas.toBlob(). The pHYs chunk stores pixels-per-unit on each axis
 * and a unit specifier (1 = meter). This is the standard way to embed PPI
 * in PNG files (used by Photoshop, GIMP, Figma, etc.).
 *
 * The injection is a pure byte-level operation on the PNG stream: it parses
 * chunk boundaries, inserts a pHYs chunk before IEND (or replaces an
 * existing one), and recomputes CRC32. No image decoding is performed.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array, start: number, length: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < start + length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  );
}

/** Minimum valid PNG: 8-byte signature + IHDR (13 data + 12 overhead) + IEND (0 data + 12 overhead). */
const MIN_PNG_SIZE = 8 + 25 + 12;

/**
 * Insert or replace a pHYs chunk in a PNG byte stream.
 *
 * If an existing pHYs chunk is found, it is replaced in-place. Otherwise,
 * the chunk is inserted immediately before IEND.
 *
 * @param png - Original PNG bytes (from canvas.toBlob).
 * @param ppuX - Pixels per unit, X axis (e.g. 300 * 39.3701 ≈ 11811 for 300 PPI in metric).
 * @param ppuY - Pixels per unit, Y axis.
 * @param unit - Unit specifier: 1 = meter, 0 = unknown (aspect-ratio only).
 * @returns New Uint8Array with the pHYs chunk injected. The original is not mutated.
 */
export function injectPngPhys(
  png: Uint8Array,
  ppuX: number,
  ppuY: number,
  unit: 0 | 1 = 1,
): Uint8Array {
  if (png.length < MIN_PNG_SIZE) return png;

  // Verify PNG signature.
  const sig = png.slice(0, 8);
  const expectedSig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let sigOk = true;
  for (let i = 0; i < 8; i++) {
    if (sig[i] !== expectedSig[i]) {
      sigOk = false;
      break;
    }
  }
  if (!sigOk) return png;

  // Scan chunks. Minimum scannable unit is8 bytes (4 length + 4 type) — the IEND
  // chunk has0 data bytes, so requiring 12 (= length + type + data) would skip it
  // when it sits at the exact end of the buffer.
  let offset = 8; // skip signature
  let physOffset = -1;
  let physEnd = -1;
  let iendOffset = -1;

  while (offset + 8 <= png.length) {
    const length = readUint32BE(png, offset);
    const type = String.fromCharCode(
      png[offset + 4]!,
      png[offset + 5]!,
      png[offset + 6]!,
      png[offset + 7]!,
    );

    if (offset + 12 + length > png.length) break; // truncated chunk data

    if (type === 'pHYs') {
      physOffset = offset;
      physEnd = offset + 12 + length;
    }
    if (type === 'IEND') {
      iendOffset = offset;
      break;
    }

    offset += 12 + length;
  }

  if (iendOffset === -1) return png; // no IEND found

  // Build the pHYs chunk directly in 21 bytes: 4 len + 4 type + 9 data + 4 CRC.
  // CRC covers type + data only (13 bytes at offsets 4..16).
  const physChunk = new Uint8Array(21);
  writeUint32BE(physChunk, 0, 9); // data length = 9
  physChunk[4] = 0x70; // 'p'
  physChunk[5] = 0x48; // 'H'
  physChunk[6] = 0x59; // 'Y'
  physChunk[7] = 0x73; // 's'
  writeUint32BE(physChunk, 8, Math.round(ppuX));
  writeUint32BE(physChunk, 12, Math.round(ppuY));
  physChunk[16] = unit;
  const crc = crc32(physChunk, 4, 13);
  writeUint32BE(physChunk, 17, crc);

  // Assemble output: before-pHYs + physChunk + after-pHYs (skip old pHYs if present).
  const removeStart = physOffset >= 0 ? physOffset : iendOffset;
  const removeEnd = physOffset >= 0 ? physEnd : iendOffset;
  const before = png.slice(0, removeStart);
  const after = png.slice(removeEnd);
  const result = new Uint8Array(before.length + physChunk.length + after.length);
  result.set(before, 0);
  result.set(physChunk, before.length);
  result.set(after, before.length + physChunk.length);
  return result;
}

/**
 * Convert PPI (pixels per inch) to pixels per meter for pHYs.
 * 1 inch = 0.0254 meters → ppi / 0.0254 = ppm.
 */
export function ppiToPixelsPerMeter(ppi: number): number {
  return Math.round(ppi / 0.0254);
}

/**
 * Read the pHYs chunk from a PNG byte stream.
 * Returns null when no pHYs chunk is present or the PNG is malformed.
 */
export function readPngPhys(png: Uint8Array): { ppuX: number; ppuY: number; unit: 0 | 1 } | null {
  if (png.length < MIN_PNG_SIZE) return null;

  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = readUint32BE(png, offset);
    const type = String.fromCharCode(
      png[offset + 4]!,
      png[offset + 5]!,
      png[offset + 6]!,
      png[offset + 7]!,
    );

    if (type === 'pHYs' && offset + 12 + length >= png.length) return null; // truncated

    if (type === 'pHYs' && length === 9) {
      return {
        ppuX: readUint32BE(png, offset + 8),
        ppuY: readUint32BE(png, offset + 12),
        unit: png[offset + 16] as 0 | 1,
      };
    }

    if (type === 'IEND') return null;
    offset += 12 + length;
  }
  return null;
}
