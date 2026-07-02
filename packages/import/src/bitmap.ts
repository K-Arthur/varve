const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

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
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
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
    const raw = readUint16BE(data, 26);
    const w = raw & 0x3fff;
    const raw2 = readUint16BE(data, 28);
    const h = raw2 & 0x3fff;
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
