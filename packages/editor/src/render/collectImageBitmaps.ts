/**
 * Pre-decode image fills on the main thread for Structured Clone worker transport.
 */
import type { RenderItem } from '@strata/engine';
import { getImageCache } from '@strata/engine';

/** Close every distinct ImageBitmap in a map. */
export function closeImageBitmapMap(images: Readonly<Record<string, ImageBitmap>>): void {
  const closed = new Set<ImageBitmap>();
  for (const bitmap of Object.values(images)) {
    if (closed.has(bitmap)) continue;
    bitmap.close();
    closed.add(bitmap);
  }
}

/** Replace a worker image map and release bitmaps no longer retained by identity. */
export function replaceImageBitmapMap(
  current: Readonly<Record<string, ImageBitmap>>,
  next: Record<string, ImageBitmap>,
): Record<string, ImageBitmap> {
  const retained = new Set(Object.values(next));
  const obsolete: Record<string, ImageBitmap> = {};
  for (const [src, bitmap] of Object.entries(current)) {
    if (!retained.has(bitmap)) obsolete[src] = bitmap;
  }
  closeImageBitmapMap(obsolete);
  return next;
}

/** Collect image src URLs referenced by IR fill stacks. */
export function imageSrcsFromIr(ir: RenderItem[]): string[] {
  const srcs = new Set<string>();
  for (const item of ir) {
    const fills = item.fills ?? [];
    for (const fill of fills) {
      if (fill.type === 'image' && fill.src && fill.visible !== false) {
        srcs.add(fill.src);
      }
    }
    const fill = item.fill;
    if (
      fill &&
      typeof fill === 'object' &&
      'type' in fill &&
      (fill as { type: string }).type === 'image' &&
      'src' in fill &&
      typeof (fill as { src?: string }).src === 'string'
    ) {
      srcs.add((fill as { src: string }).src);
    }
  }
  return [...srcs];
}

/**
 * Load all image fills from ImageCache and produce transferable ImageBitmaps.
 * Returns null when any required src is not yet loaded (caller keeps main-thread path).
 */
export async function collectImageBitmaps(
  ir: RenderItem[],
): Promise<{ images: Record<string, ImageBitmap>; transfer: Transferable[] } | null> {
  const srcs = imageSrcsFromIr(ir);
  if (srcs.length === 0) return { images: {}, transfer: [] };

  const cache = getImageCache();
  const images: Record<string, ImageBitmap> = {};
  const transfer: Transferable[] = [];

  const fail = (): null => {
    closeImageBitmapMap(images);
    return null;
  };

  for (const src of srcs) {
    if (!cache.isLoaded(src)) {
      void cache.load(src).catch(() => undefined);
      return fail();
    }
    const img = cache.getImage(src);
    if (!img) return fail();
    try {
      const bitmap = await createImageBitmap(img);
      images[src] = bitmap;
      transfer.push(bitmap);
    } catch {
      return fail();
    }
  }

  return { images, transfer };
}
