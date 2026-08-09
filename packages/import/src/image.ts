import type { Fill } from '@varve/scene';
import { imageFill } from '@varve/scene';
import { bytesToDataUrl } from './bitmap';
import { inspectRasterBytes } from './rasterInspection';

export interface ImageImportOptions {
  embedAsDataUrl?: boolean;
}

export function importImageAsFill(
  data: Uint8Array | ArrayBuffer,
  filename: string,
  options?: ImageImportOptions,
): Fill {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const inspection = inspectRasterBytes(bytes);
  const src =
    options?.embedAsDataUrl !== false ? bytesToDataUrl(bytes, inspection.mimeType) : filename;

  const fill = imageFill(src, { fit: 'fill' });
  return fill.image
    ? {
        ...fill,
        image: {
          ...fill.image,
          imageWidth: inspection.width,
          imageHeight: inspection.height,
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
