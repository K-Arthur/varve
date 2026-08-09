const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];
const GIF_HEADER = [0x47, 0x49, 0x46, 0x38];
const TIFF_LE_HEADER = [0x49, 0x49, 0x2a, 0x00];
const TIFF_BE_HEADER = [0x4d, 0x4d, 0x00, 0x2a];
const AVIF_HEADER = [0x00, 0x00, 0x00]; // box size prefix, followed by 'ftypavif'

export interface ImageDimensions {
  w: number;
  h: number;
}

export function getImageDimensions(data: Uint8Array): ImageDimensions {
  const header = Array.from(data.slice(0, 12));

  if (startsWith(header, PNG_HEADER)) {
    return readPngDimensions(data);
  }

  if (startsWith(header, JPEG_HEADER)) {
    return readJpegDimensions(data);
  }

  if (startsWith(header, WEBP_HEADER) && data.length >= 12) {
    const magic = Array.from(data.slice(8, 12));
    if (arraysEqual(magic, WEBP_MAGIC)) {
      return readWebpDimensions(data);
    }
  }

  if (startsWith(header, GIF_HEADER)) {
    return readGifDimensions(data);
  }

  if (startsWith(header, TIFF_LE_HEADER) || startsWith(header, TIFF_BE_HEADER)) {
    return readTiffDimensions(data);
  }

  if (data.length >= 12 && startsWith(header, AVIF_HEADER)) {
    const ftyp = Array.from(data.slice(4, 12));
    if (arraysEqual(ftyp, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])) {
      return readAvifDimensions(data);
    }
  }

  // BMP: "BM" magic at offset 0; width at offset 18, height at offset 22 (LE)
  if (data.length >= 26 && data[0] === 0x42 && data[1] === 0x4d) {
    return readBmpDimensions(data);
  }

  return { w: 0, h: 0 };
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function startsWith(haystack: number[], needle: number[]): boolean {
  if (haystack.length < needle.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (haystack[i] !== needle[i]) return false;
  }
  return true;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readUint16BE(data: Uint8Array, offset: number): number {
  if (offset + 1 >= data.length) return 0;
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function readUint32BE(data: Uint8Array, offset: number): number {
  if (offset + 3 >= data.length) return 0;
  return (
    (((data[offset] ?? 0) << 24) |
      ((data[offset + 1] ?? 0) << 16) |
      ((data[offset + 2] ?? 0) << 8) |
      (data[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint32LE(data: Uint8Array, offset: number): number {
  if (offset + 3 >= data.length) return 0;
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readPngDimensions(data: Uint8Array): ImageDimensions {
  const w = readUint32BE(data, 16);
  const h = readUint32BE(data, 20);
  return { w, h };
}

function readJpegDimensions(data: Uint8Array): ImageDimensions {
  let offset = 2;
  while (offset < data.length - 1) {
    if (data[offset] !== 0xff) break;
    const marker = data[offset + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (offset + 7 >= data.length) return { w: 0, h: 0 };
      const h = readUint16BE(data, offset + 5);
      const w = readUint16BE(data, offset + 7);
      return { w, h };
    }
    const length = readUint16BE(data, offset + 2);
    if (length === 0) break;
    offset += length + 2;
  }
  return { w: 0, h: 0 };
}

function readWebpDimensions(data: Uint8Array): ImageDimensions {
  if (data.length < 30) return { w: 0, h: 0 };
  const vp8Magic = Array.from(data.slice(12, 16));
  if (arraysEqual(vp8Magic, [0x56, 0x50, 0x38, 0x20])) {
    if (data.length < 30) return { w: 0, h: 0 };
    // VP8 frame header: width/height are 14-bit big-endian; ImageMagick's
    // encoder emits them little-endian, so fall back when the BE read is 0.
    const raw = readUint16BE(data, 26);
    const raw2 = readUint16BE(data, 28);
    const w = raw & 0x3fff;
    const h = raw2 & 0x3fff;
    if (w === 0 && h === 0 && data.length >= 30) {
      return {
        w: readUint16LE(data, 26) & 0x3fff || 0,
        h: readUint16LE(data, 28) & 0x3fff || 0,
      };
    }
    return { w, h };
  }
  if (arraysEqual(vp8Magic, [0x56, 0x50, 0x38, 0x4c])) {
    const bits = readUint32LE(data, 21);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { w, h };
  }
  if (arraysEqual(vp8Magic, [0x56, 0x50, 0x38, 0x58])) {
    const w = readUint24LE(data, 24) + 1;
    const h = readUint24LE(data, 27) + 1;
    return { w, h };
  }
  return { w: 0, h: 0 };
}

function readUint24LE(data: Uint8Array, offset: number): number {
  if (offset + 2 >= data.length) return 0;
  return (
    ((data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16)) >>> 0
  );
}

function readUint16LE(data: Uint8Array, offset: number): number {
  if (offset + 1 >= data.length) return 0;
  return ((data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)) >>> 0;
}

function readGifDimensions(data: Uint8Array): ImageDimensions {
  if (data.length < 10) return { w: 0, h: 0 };
  const w = readUint16LE(data, 6);
  const h = readUint16LE(data, 8);
  return { w, h };
}

function readTiffDimensions(data: Uint8Array): ImageDimensions {
  if (data.length < 8) return { w: 0, h: 0 };
  const isLE = data[0] === 0x49;
  const readU16 = (offset: number) =>
    isLE ? readUint16LE(data, offset) : readUint16BE(data, offset);
  const readU32 = (offset: number) =>
    isLE ? readUint32LE(data, offset) : readUint32BE(data, offset);

  const ifdOffset = readU32(4);
  if (ifdOffset + 2 > data.length) return { w: 0, h: 0 };

  const entryCount = readU16(ifdOffset);
  let w = 0;
  let h = 0;

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > data.length) break;
    const tag = readU16(entryOffset);
    const value = readU32(entryOffset + 8);
    if (tag === 0x0100) w = value;
    if (tag === 0x0101) h = value;
  }

  return { w, h };
}

function readBmpDimensions(data: Uint8Array): ImageDimensions {
  const w = readUint32LE(data, 18);
  const h = Math.abs(readUint32LE(data, 22) | 0); // height can be negative for top-down BMP
  return { w, h };
}

function readAvifDimensions(data: Uint8Array): ImageDimensions {
  // AVIF uses ISOBMFF boxes. Scan top-level boxes for 'meta', then scan
  // its children for 'ispe' (ImageSpatialExtents).
  let offset = 0;
  while (offset + 8 <= data.length) {
    const boxSize = readUint32BE(data, offset);
    const boxType = String.fromCharCode(
      data[offset + 4] ?? 0,
      data[offset + 5] ?? 0,
      data[offset + 6] ?? 0,
      data[offset + 7] ?? 0,
    );
    if (boxType === 'ispe') {
      if (offset + 20 > data.length) return { w: 0, h: 0 };
      const w = readUint32BE(data, offset + 12);
      const h = readUint32BE(data, offset + 16);
      return { w, h };
    }
    if (boxType === 'meta') {
      // meta is a full box: 4 bytes version+flags after type
      // Scan children inside meta box (offset+12 to offset+boxSize)
      let inner = offset + 12;
      const metaEnd = boxSize > 0 ? offset + boxSize : data.length;
      while (inner + 8 <= metaEnd && inner + 8 <= data.length) {
        const innerSize = readUint32BE(data, inner);
        const innerType = String.fromCharCode(
          data[inner + 4] ?? 0,
          data[inner + 5] ?? 0,
          data[inner + 6] ?? 0,
          data[inner + 7] ?? 0,
        );
        if (innerType === 'ispe') {
          if (inner + 20 > data.length) return { w: 0, h: 0 };
          const w = readUint32BE(data, inner + 12);
          const h = readUint32BE(data, inner + 16);
          return { w, h };
        }
        if (innerSize < 8) break;
        inner += innerSize;
      }
    }
    if (boxSize < 8) break;
    offset += boxSize;
  }
  return { w: 0, h: 0 };
}

export function detectImageMime(data: Uint8Array): string | null {
  const header = Array.from(data.slice(0, 12));

  if (startsWith(header, PNG_HEADER)) return 'image/png';
  if (startsWith(header, JPEG_HEADER)) return 'image/jpeg';
  if (startsWith(header, GIF_HEADER)) return 'image/gif';
  if (startsWith(header, TIFF_LE_HEADER) || startsWith(header, TIFF_BE_HEADER)) return 'image/tiff';

  if (startsWith(header, WEBP_HEADER) && data.length >= 12) {
    const magic = Array.from(data.slice(8, 12));
    if (arraysEqual(magic, WEBP_MAGIC)) return 'image/webp';
  }

  if (data.length >= 12 && startsWith(header, AVIF_HEADER)) {
    const ftyp = Array.from(data.slice(4, 12));
    if (arraysEqual(ftyp, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])) return 'image/avif';
  }

  if (data.length >= 2) {
    const b0 = data[0] ?? 0;
    const b1 = data[1] ?? 0;
    if (b0 === 0x42 && b1 === 0x4d) return 'image/bmp';
  }

  return null;
}
