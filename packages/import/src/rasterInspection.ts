import { probeAnimatedMedia } from '@varve/engine';
import type { AnimatedAssetMetadata } from '@varve/shared';
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
  /** Animated-media metadata (kind/frames/timing/loops) for animated imports. */
  animated?: AnimatedAssetMetadata;
}

export interface RasterInspectionLimits {
  maxEncodedBytes?: number;
  maxPixels?: number;
  maxDimension?: number;
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

  // Content-level animation detection (never extension-based): a GIF/APNG/
  // WebP whose container declares more than one frame is animated; static
  // variants of those formats stay static. Metadata is probed from the
  // container and persisted on the asset; the original bytes stay
  // authoritative.
  let animation: 'static' | 'animated' = 'static';
  let animated: AnimatedAssetMetadata | undefined;
  if (mimeType === 'image/gif' || mimeType === 'image/png' || mimeType === 'image/webp') {
    try {
      const probed = probeAnimatedMedia(bytes);
      if (probed.kind === 'gif' || probed.kind === 'apng' || probed.kind === 'webp') {
        animation = 'animated';
        animated = probed.metadata;
      }
    } catch (error) {
      // A corrupt animated container should fail like any corrupt image:
      // the runtime decoder is authoritative, but a clearly broken header
      // is a rejected import.
      throw new Error(
        error instanceof Error
          ? `Unsupported or corrupt image: ${error.message}`
          : 'Unsupported or corrupt image',
      );
    }
  }

  return { mimeType, width, height, encodedBytes: bytes.byteLength, animation, animated };
}
