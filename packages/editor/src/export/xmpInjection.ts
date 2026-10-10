/**
 * XMP metadata injection for raster and PDF exports.
 *
 * Adds XMP packets to already-encoded bytes. This is post-encode
 * processing, never a pixel or page re-encode.
 */

/**
 * Insert XMP metadata into PNG bytes.
 * XMP is stored in an iTXt chunk with keyword "XML:com.adobe.xmp".
 */
export function insertPngXmp(bytes: Uint8Array, xmpString: string): Uint8Array {
  // PNG signature
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new Error('Not a PNG byte stream');
  }

  // iTXt chunk structure:
  // 4 bytes: length (not including length/type/crc)
  // 4 bytes: type "iTXt"
  // N bytes: data (keyword + null + compression flag + compression method + language + translated keyword + null + text)
  // 4 bytes: CRC32

  const keyword = 'XML:com.adobe.xmp';
  const keywordBytes = new TextEncoder().encode(keyword);
  const xmpBytes = new TextEncoder().encode(xmpString);

  // iTXt data: keyword + null + compression flag (0) + compression method (0) + language tag + null + translated keyword + null + text
  const compressionFlag = 0;
  const compressionMethod = 0;
  const languageTag = new Uint8Array(0); // Empty
  const translatedKeyword = new Uint8Array(0); // Empty

  const dataLength =
    keywordBytes.length +
    1 +
    1 +
    1 +
    languageTag.length +
    1 +
    translatedKeyword.length +
    1 +
    xmpBytes.length;
  const chunkData = new Uint8Array(dataLength);
  let offset = 0;

  chunkData.set(keywordBytes, offset);
  offset += keywordBytes.length;
  chunkData[offset++] = 0; // Null separator

  chunkData[offset++] = compressionFlag;
  chunkData[offset++] = compressionMethod;

  chunkData.set(languageTag, offset);
  offset += languageTag.length;
  chunkData[offset++] = 0; // Null separator

  chunkData.set(translatedKeyword, offset);
  offset += translatedKeyword.length;
  chunkData[offset++] = 0; // Null separator

  chunkData.set(xmpBytes, offset);

  // Build the complete chunk
  const chunkType = new Uint8Array([0x69, 0x54, 0x58, 0x74]); // "iTXt"
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, dataLength, false);

  // Calculate CRC32 (type + data)
  const crcInput = new Uint8Array(chunkType.length + chunkData.length);
  crcInput.set(chunkType, 0);
  crcInput.set(chunkData, chunkType.length);
  const crc = crc32(crcInput);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crc, false);

  const fullChunk = new Uint8Array(
    lengthBytes.length + chunkType.length + chunkData.length + crcBytes.length,
  );
  let chunkOffset = 0;
  fullChunk.set(lengthBytes, chunkOffset);
  chunkOffset += lengthBytes.length;
  fullChunk.set(chunkType, chunkOffset);
  chunkOffset += chunkType.length;
  fullChunk.set(chunkData, chunkOffset);
  chunkOffset += chunkData.length;
  fullChunk.set(crcBytes, chunkOffset);

  // Insert before IEND chunk (last 12 bytes of valid PNG)
  const iendPos = bytes.length - 12;
  const result = new Uint8Array(bytes.length + fullChunk.length);
  result.set(bytes.subarray(0, iendPos), 0);
  result.set(fullChunk, iendPos);
  result.set(bytes.subarray(iendPos), iendPos + fullChunk.length);

  return result;
}

/**
 * Insert XMP metadata into JPEG bytes.
 * XMP is stored in an APP1 segment with "http://ns.adobe.com/xap/1.0/\0" marker.
 */
export function insertJpegXmp(bytes: Uint8Array, xmpString: string): Uint8Array {
  // JPEG SOI marker
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Not a JPEG byte stream');
  }

  const xmpMarker = 'http://ns.adobe.com/xap/1.0/\0';
  const markerBytes = new TextEncoder().encode(xmpMarker);
  const xmpBytes = new TextEncoder().encode(xmpString);

  // APP1 marker: 0xFF 0xE1
  // Length: 2 bytes (includes length itself + marker + xmp, but not the APP1 marker)
  const segmentLength = 2 + markerBytes.length + xmpBytes.length;
  if (segmentLength > 65535) {
    throw new Error('XMP data too large for JPEG APP1 segment');
  }

  const segment = new Uint8Array(2 + 2 + markerBytes.length + xmpBytes.length);
  segment[0] = 0xff;
  segment[1] = 0xe1; // APP1
  new DataView(segment.buffer).setUint16(2, segmentLength, false);
  segment.set(markerBytes, 4);
  segment.set(xmpBytes, 4 + markerBytes.length);

  // Insert after SOI (after first 2 bytes)
  const result = new Uint8Array(bytes.length + segment.length);
  result.set(bytes.subarray(0, 2), 0);
  result.set(segment, 2);
  result.set(bytes.subarray(2), 2 + segment.length);

  return result;
}

function lastMatch(text: string, pattern: RegExp): RegExpMatchArray | undefined {
  return [...text.matchAll(pattern)].at(-1);
}

function xrefOffset(value: number): string {
  return `${String(value).padStart(10, '0')} 00000 n \n`;
}

/**
 * Insert XMP as a PDF Metadata stream via an incremental update.
 *
 * Classic-xref files (the browser raster-PDF fallback) get a new Catalog
 * that points at the stream. Xref-stream files still receive a valid
 * incremental object so scanners that look for `<?xpacket` find the packet.
 */
export function insertPdfXmp(bytes: Uint8Array, xmpString: string): Uint8Array {
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.startsWith('%PDF-')) {
    throw new Error('Not a PDF byte stream');
  }

  const lastXref = lastMatch(text, /startxref\s+(\d+)\s*%%EOF/g);
  const lastTrailer = lastMatch(text, /trailer\s*<<([\s\S]*?)>>\s*startxref/g);
  const sizeMatch = lastTrailer?.[1]?.match(/\/Size\s+(\d+)/);
  const pagesMatch = text.match(/\/Type\s*\/Catalog[\s\S]{0,800}?\/Pages\s+(\d+\s+0\s+R)/);

  const objectMatches = [...text.matchAll(/(\d+)\s+0\s+obj/g)];
  const maxExistingId = objectMatches.reduce((max, match) => {
    const id = Number(match[1]);
    return Number.isFinite(id) && id > max ? id : max;
  }, 0);
  const nextId = sizeMatch ? Number(sizeMatch[1]) : maxExistingId + 1;
  const metaId = nextId;
  const catalogId = nextId + 1;
  const pagesRef = pagesMatch?.[1] ?? '2 0 R';
  const prevXref = lastXref ? Number(lastXref[1]) : undefined;

  const encoder = new TextEncoder();
  const xmpBytes = encoder.encode(xmpString);
  const metaHeader = encoder.encode(
    `\n${metaId} 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${xmpBytes.length} >>\nstream\n`,
  );
  const metaFooter = encoder.encode('\nendstream\nendobj\n');
  const catalog = encoder.encode(
    `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesRef} /Metadata ${metaId} 0 R >>\nendobj\n`,
  );

  const metaOffset = bytes.length + 1;
  const catalogOffset = bytes.length + metaHeader.length + xmpBytes.length + metaFooter.length;
  const xrefOffsetPos = catalogOffset + catalog.length;
  const prevClause = prevXref === undefined ? '' : ` /Prev ${prevXref}`;
  const xref = encoder.encode(
    `xref\n0 1\n0000000000 65535 f \n${metaId} 2\n${xrefOffset(metaOffset)}${xrefOffset(catalogOffset)}trailer\n<< /Size ${catalogId + 1} /Root ${catalogId} 0 R${prevClause} >>\nstartxref\n${xrefOffsetPos}\n%%EOF\n`,
  );

  const result = new Uint8Array(
    bytes.length +
      metaHeader.length +
      xmpBytes.length +
      metaFooter.length +
      catalog.length +
      xref.length,
  );
  result.set(bytes, 0);
  let pos = bytes.length;
  result.set(metaHeader, pos);
  pos += metaHeader.length;
  result.set(xmpBytes, pos);
  pos += xmpBytes.length;
  result.set(metaFooter, pos);
  pos += metaFooter.length;
  result.set(catalog, pos);
  pos += catalog.length;
  result.set(xref, pos);
  return result;
}

/**
 * CRC32 implementation for PNG chunks.
 * Standard CRC32 with polynomial 0xEDB88320.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte === undefined) continue;
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
