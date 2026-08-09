/**
 * Pre-decode image fills on the main thread for Structured Clone worker transport.
 */
import type { RenderItem } from '@varve/engine';
import { getImageCache } from '@varve/engine';
import { checkFault } from './faultInjection';
import { estimateRgbaBytes } from './renderBitmapBudget';

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

/**
 * Apply a transport delta to the worker's retained image map. The manifest is
 * authoritative: sources no longer referenced by the frame are closed, while
 * unchanged sources retain their existing bitmap identity.
 */
export function reconcileImageBitmapMap(
  current: Readonly<Record<string, ImageBitmap>>,
  incoming: Readonly<Record<string, ImageBitmap>>,
  requiredSources: readonly string[],
): Record<string, ImageBitmap> {
  const next: Record<string, ImageBitmap> = {};
  for (const src of requiredSources) {
    const bitmap = incoming[src] ?? current[src];
    if (bitmap) next[src] = bitmap;
  }

  const retained = new Set(Object.values(next));
  const obsolete: Record<string, ImageBitmap> = {};
  for (const [src, bitmap] of [...Object.entries(current), ...Object.entries(incoming)]) {
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
    const primitive = item.primitive;
    if (
      primitive &&
      typeof primitive === 'object' &&
      primitive.kind === 'warpedImage' &&
      typeof primitive.src === 'string'
    ) {
      srcs.add(primitive.src);
    }
  }
  return [...srcs];
}

/**
 * Load all image fills from ImageCache and produce transferable ImageBitmaps.
 * Returns null when any required src is not yet loaded (caller keeps main-thread path)
 * or when the transfer would exceed the entry cap (caller falls back to main-thread).
 */
export interface CollectImageBitmapsOptions {
  /** Cap the number of distinct image fills decoded for one transfer. */
  maxEntries?: number;
  /** Sources the current worker generation can already draw without transfer. */
  residentSources?: ReadonlySet<string>;
}

export async function collectImageBitmaps(
  ir: RenderItem[],
  options: CollectImageBitmapsOptions = {},
): Promise<{
  images: Record<string, ImageBitmap>;
  transfer: Transferable[];
  bytes: number;
  /** Full authoritative source manifest for the frame, including residents. */
  sources: string[];
} | null> {
  const srcs = imageSrcsFromIr(ir);
  if (srcs.length === 0) return { images: {}, transfer: [], bytes: 0, sources: [] };

  const cache = getImageCache();
  const images: Record<string, ImageBitmap> = {};
  const transfer: Transferable[] = [];
  const maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
  let bytes = 0;

  if (srcs.length > maxEntries) return null;

  const fail = (): null => {
    closeImageBitmapMap(images);
    return null;
  };

  for (const src of srcs) {
    if (options.residentSources?.has(src)) continue;
    if (!cache.isLoaded(src)) {
      void cache.load(src).catch(() => undefined);
      return fail();
    }
    const img = cache.getImage(src);
    if (!img) return fail();
    try {
      if (checkFault('image-bitmap-create')) {
        throw new DOMException('injected createImageBitmap fault', 'AbortError');
      }
      const bitmap = await createImageBitmap(img);
      images[src] = bitmap;
      transfer.push(bitmap);
      bytes += estimateRgbaBytes(bitmap.width, bitmap.height);
    } catch {
      return fail();
    }
  }

  return { images, transfer, bytes, sources: srcs };
}
