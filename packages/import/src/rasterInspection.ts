import { detectImageMime, getImageDimensions } from './bitmap';

export const MAX_RASTER_ENCODED_BYTES = 128 * 1024 * 1024;
export const MAX_RASTER_PIXELS = 64 * 1024 * 1024;
export const MAX_RASTER_DIMENSION = 65_535;

const DECODABLE_RASTER_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
]);

export interface RasterInspection {
  mimeType: string;
  width: number;
  height: number;
  encodedBytes: number;
  animation: 'static' | 'animated';
}

export interface RasterInspectionLimits {
  maxEncodedBytes?: number;
  maxPixels?: number;
  maxDimension?: number;
}

function gifFrameCount(bytes: Uint8Array): number {
  if (bytes.length < 13) return 0;
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1);
  let frames = 0;

  const skipSubBlocks = (): boolean => {
    while (offset < bytes.length) {
      const size = bytes[offset] ?? 0;
      offset++;
      if (size === 0) return true;
      if (offset + size > bytes.length) return false;
      offset += size;
    }
    return false;
  };

  while (offset < bytes.length) {
    const marker = bytes[offset] ?? 0;
    offset++;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      if (offset >= bytes.length) break;
      offset++; // extension label
      if (!skipSubBlocks()) break;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) break;
    frames++;
    const imagePacked = bytes[offset + 8] ?? 0;
    offset += 9;
    if ((imagePacked & 0x80) !== 0) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    if (offset >= bytes.length) break;
    offset++; // LZW minimum code size
    if (!skipSubBlocks()) break;
    if (frames > 1) return frames;
  }
  return frames;
}

/**
 * Validate encoded raster bytes before data-URL allocation or browser decode.
 * This is intentionally a cheap header gate, not a codec replacement: the
 * runtime decoder remains authoritative for corrupt payload details.
 */
export function inspectRasterBytes(
  bytes: Uint8Array,
  limits: RasterInspectionLimits = {},
): RasterInspection {
  const maxEncodedBytes = limits.maxEncodedBytes ?? MAX_RASTER_ENCODED_BYTES;
  const maxPixels = limits.maxPixels ?? MAX_RASTER_PIXELS;
  const maxDimension = limits.maxDimension ?? MAX_RASTER_DIMENSION;

  if (bytes.byteLength < 4) throw new Error('Image file is empty or too small');
  if (bytes.byteLength > maxEncodedBytes) {
    throw new Error(`Image file exceeds the ${maxEncodedBytes}-byte encoded size limit`);
  }

  const mimeType = detectImageMime(bytes);
  if (!mimeType) throw new Error('Unsupported image signature or corrupt image header');
  if (!DECODABLE_RASTER_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image format: ${mimeType}`);
  }

  const { w: width, h: height } = getImageDimensions(bytes);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions are missing or corrupt');
  }
  if (width > maxDimension || height > maxDimension) {
    throw new Error(`Image dimension exceeds the ${maxDimension}-pixel limit`);
  }
  if (width > Math.floor(maxPixels / height)) {
    throw new Error(`Image exceeds the ${maxPixels}-pixel decoded pixel budget`);
  }

  const animation = mimeType === 'image/gif' && gifFrameCount(bytes) > 1 ? 'animated' : 'static';
  if (animation === 'animated') {
    throw new Error('Animated GIF is not supported; import a still frame instead');
  }

  return { mimeType, width, height, encodedBytes: bytes.byteLength, animation };
}
