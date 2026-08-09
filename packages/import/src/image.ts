import type { Fill } from '@varve/scene';
import { imageFill } from '@varve/scene';
import { bytesToDataUrl } from './bitmap';
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
  mimeType: string;
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
}

/**
 * Content-sniff, validate, and extract normalized metadata from raster
 * bytes in one pass. The displayed (oriented) dimensions are the ones the
 * browser decoder will produce, so placement, crop, and hit testing all
 * agree with the decoded image.
 */
export function inspectImageSource(data: Uint8Array): InspectedImageSource {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const inspection = inspectRasterBytes(bytes);
  const metadata = extractImageSourceMetadata(bytes, inspection.mimeType);
  const displayed = displayedDimensions(inspection.width, inspection.height, metadata);
  let iccProfileBase64: string | undefined;
  if (metadata.icc.kind === 'valid') {
    iccProfileBase64 = bytesToBase64(metadata.icc.profile.bytes);
  }
  return {
    mimeType: inspection.mimeType,
    storedWidth: inspection.width,
    storedHeight: inspection.height,
    displayedWidth: displayed.width,
    displayedHeight: displayed.height,
    metadata,
    ...(iccProfileBase64 ? { iccProfileBase64 } : {}),
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
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
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
