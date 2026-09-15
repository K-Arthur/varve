/// <reference path="./image-codecs.d.ts" />
import type { Fill } from '@varve/scene';
import { imageFill } from '@varve/scene';
import type { AnimatedAssetMetadata } from '@varve/shared';
import UPNG from 'upng-js';
import UTIF from 'utif';
import { bytesToDataUrl, detectImageMime } from './bitmap';
import {
  displayedDimensions,
  extractImageSourceMetadata,
  type ImageSourceMetadata,
  type SourceIccStatus,
} from './metadata';
import { inspectRasterBytes } from './rasterInspection';

export interface ImageImportOptions {
  embedAsDataUrl?: boolean;
}

/** Full ingestion-time view of one raster source (stored + displayed). */
export interface InspectedImageSource {
  /** MIME type of the bytes used by the browser/runtime decoder. */
  mimeType: string;
  /** Original content-sniffed MIME type when normalization changed it. */
  sourceMimeType?: string;
  /** Stored (pre-orientation) pixel dimensions. */
  storedWidth: number;
  storedHeight: number;
  /** Displayed (orientation-normalized) pixel dimensions. */
  displayedWidth: number;
  displayedHeight: number;
  /** Normalized EXIF + ICC metadata. */
  metadata: ImageSourceMetadata;
  /** ICC payload for the document profile registry, when valid. */
  iccProfileBase64?: string;
  /** Animated-media container facts for animated GIF/APNG/WebP imports. */
  animated?: AnimatedAssetMetadata;
}

/**
 * Content-sniff, validate, and extract normalized metadata from raster
 * bytes in one pass. The displayed (oriented) dimensions are the ones the
 * browser decoder will produce, so placement, crop, and hit testing all
 * agree with the decoded image.
 */
export function inspectImageSource(data: Uint8Array): InspectedImageSource {
  const sourceBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const sourceInspection = inspectRasterBytes(sourceBytes);
  const bytes = normalizeRasterBytes(sourceBytes);
  const inspection = inspectRasterBytes(bytes);
  // Read colour/orientation metadata from the original container. TIFF is
  // normalized to PNG for browser decode, and inspecting the normalized bytes
  // would silently replace TIFF photometric/bit-depth provenance with PNG
  // defaults.
  const metadata = extractImageSourceMetadata(sourceBytes, sourceInspection.mimeType);
  const displayed = displayedDimensions(sourceInspection.width, sourceInspection.height, metadata);
  let iccProfileBase64: string | undefined;
  if (metadata.icc.kind === 'valid') {
    iccProfileBase64 = bytesToBase64(metadata.icc.profile.bytes);
  }
  return {
    mimeType: inspection.mimeType,
    ...(sourceInspection.mimeType !== inspection.mimeType
      ? { sourceMimeType: sourceInspection.mimeType }
      : {}),
    storedWidth: sourceInspection.width,
    storedHeight: sourceInspection.height,
    displayedWidth: displayed.width,
    displayedHeight: displayed.height,
    metadata,
    ...(iccProfileBase64 ? { iccProfileBase64 } : {}),
    ...(inspection.animated ? { animated: inspection.animated } : {}),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export function importImageAsFill(
  data: Uint8Array | ArrayBuffer,
  filename: string,
  options?: ImageImportOptions,
): Fill {
  const sourceBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const bytes = normalizeRasterBytes(sourceBytes);
  const inspection = inspectImageSource(bytes);
  const src =
    options?.embedAsDataUrl !== false ? bytesToDataUrl(bytes, inspection.mimeType) : filename;

  const fill = imageFill(src, { fit: 'fill' });
  return fill.image
    ? {
        ...fill,
        image: {
          ...fill.image,
          imageWidth: inspection.displayedWidth,
          imageHeight: inspection.displayedHeight,
        },
      }
    : fill;
}

/** Convert TIFF to PNG because browser image elements do not decode TIFF. */
export function normalizeRasterBytes(data: Uint8Array): Uint8Array {
  if (detectImageMime(data) !== 'image/tiff') return data;
  // Validate encoded size, dimensions, and decoded-pixel budget before UTIF
  // reads the strip offsets and allocates a decoded raster.
  inspectRasterBytes(data);
  const buffer = new Uint8Array(data).buffer;
  const ifds = UTIF.decode(buffer);
  const first = ifds[0];
  if (!first) throw new Error('TIFF contains no image frames');
  UTIF.decodeImage(buffer, first);
  const rgba = UTIF.toRGBA8(first);
  const encoded = UPNG.encode([new Uint8Array(rgba).slice().buffer], first.width, first.height, 0);
  return new Uint8Array(encoded);
}

export interface BitmapInfo {
  w: number;
  h: number;
  mime: string;
}

export function getBitmapInfo(data: Uint8Array): BitmapInfo {
  const inspection = inspectRasterBytes(data);
  return { w: inspection.width, h: inspection.height, mime: inspection.mimeType };
}

export type { ImageSourceMetadata, SourceIccStatus };
