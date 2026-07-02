import type { Fill } from '@strata/scene';
import { imageFill } from '@strata/scene';
import { bytesToDataUrl, getImageDimensions } from './bitmap';

export interface ImageImportOptions {
  embedAsDataUrl?: boolean;
}

export function importImageAsFill(
  data: Uint8Array | ArrayBuffer,
  filename: string,
  options?: ImageImportOptions,
): Fill {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const mime = detectMime(bytes) ?? 'image/png';
  const src = options?.embedAsDataUrl !== false ? bytesToDataUrl(bytes, mime) : filename;

  return imageFill(src, { fit: 'fill' });
}

export interface BitmapInfo {
  w: number;
  h: number;
  mime: string;
}

export function getBitmapInfo(data: Uint8Array): BitmapInfo {
  const { w, h } = getImageDimensions(data);
  const mime = detectMime(data) ?? 'image/png';
  return { w, h, mime };
}

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
    return 'image/webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}
