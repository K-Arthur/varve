/**
 * Pre-decode image fills on the main thread for Structured Clone worker transport.
 *
 * Render IR carries short resource handles for canonical assets; the
 * registry resolves them to loadable sources so the ImageCache can be
 * addressed while the worker manifest stays keyed by the handle the IR
 * actually references.
 */
import type { RenderItem } from '@varve/engine';
import { getImageCache, isImageResourceHandle, resolveImageResourceHandle } from '@varve/engine';
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

/** True when the fill carries a raster mask the worker cannot composite. */
function fillHasAlphaMask(fill: Record<string, unknown>): boolean {
  return typeof fill.alphaMask === 'string' && fill.alphaMask.length > 0;
}

/**
 * Collect every image identity referenced by IR fill stacks: canonical
 * resource handles (asset-derived) on image fills, legacy raw sources, and
 * raster-mask (alphaMask) resources so a masked fill is never transported
 * without its mask.
 */
export function imageSrcsFromIr(ir: RenderItem[]): string[] {
  const srcs = new Set<string>();
  for (const item of ir) {
    const fills = item.fills ?? [];
    for (const fill of fills) {
      if (fill.type === 'image' && fill.src && fill.visible !== false) {
        srcs.add(fill.src);
        if (fillHasAlphaMask(fill)) srcs.add(String(fill.alphaMask));
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
      if (fillHasAlphaMask(fill as Record<string, unknown>)) {
        srcs.add(String((fill as { alphaMask?: string }).alphaMask));
      }
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
 * True when a value has the canonical content-addressed handle shape
 * (`asset-<16 hex>` from the scene `hashContent` lane). Used to detect
 * unregistered handles — a handle-shaped identity the registry does not
 * know is a missing resource, not a legacy raw source.
 */
export function isHandleShaped(value: string): boolean {
  return /^asset-[0-9a-f]{16}$/.test(value);
}

/**
 * Resolve IR identities to loadable cache sources. Handles map through the
 * registry; raw sources pass through. Returns null when a referenced handle
 * is not registered — the resource is missing and the frame must stay on
 * the main thread (which shows the authoritative placeholder).
 */
export function resolveSourcesForLoad(srcs: readonly string[]): string[] | null {
  const resolved: string[] = [];
  for (const src of srcs) {
    if (isImageResourceHandle(src) || isHandleShaped(src)) {
      const loadable = resolveImageResourceHandle(src);
      if (loadable === src) return null; // unregistered handle: missing resource
      resolved.push(loadable);
    } else {
      resolved.push(src);
    }
  }
  return resolved;
}

/**
 * Worker readiness gate: a masked image fill must never reach the worker
 * without its mask (the worker has no DOM canvas to composite masks, so an
 * unmasked frame would be materially different). Scenes containing masked
 * fills are refused here and stay on the main-thread path.
 */
export function irHasUnsupportedWorkerMasks(ir: RenderItem[]): boolean {
  for (const item of ir) {
    for (const fill of item.fills ?? []) {
      if (fill.type === 'image' && fill.visible !== false && fillHasAlphaMask(fill)) return true;
    }
    const fill = item.fill as Record<string, unknown> | undefined;
    if (fill && typeof fill === 'object' && fill.type === 'image' && fillHasAlphaMask(fill)) {
      return true;
    }
  }
  return false;
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
  // Masked fills cannot be composited inside the worker: refuse the frame so
  // it falls back to the authoritative Canvas2D path (never A-without-M).
  if (irHasUnsupportedWorkerMasks(ir)) return null;

  const resolved = resolveSourcesForLoad(srcs);
  if (resolved === null) return null;

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

  for (let i = 0; i < srcs.length; i += 1) {
    const identity = srcs[i] as string;
    const loadable = resolved[i] as string;
    if (options.residentSources?.has(identity)) continue;
    if (!cache.isLoaded(loadable)) {
      void cache.load(loadable).catch(() => undefined);
      return fail();
    }
    const img = cache.getImage(loadable);
    if (!img) return fail();
    try {
      if (checkFault('image-bitmap-create')) {
        throw new DOMException('injected createImageBitmap fault', 'AbortError');
      }
      const bitmap = await createImageBitmap(img);
      // The worker map is keyed by the IR identity (the handle), so replay
      // looks the bitmap up with the exact string the IR carries.
      images[identity] = bitmap;
      transfer.push(bitmap);
      bytes += estimateRgbaBytes(bitmap.width, bitmap.height);
    } catch {
      return fail();
    }
  }

  return { images, transfer, bytes, sources: srcs };
}
