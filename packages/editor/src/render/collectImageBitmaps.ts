/**
 * Pre-decode image fills on the main thread for Structured Clone worker transport.
 *
 * Render IR carries short resource handles for canonical assets; the
 * registry resolves them to loadable sources so the ImageCache can be
 * addressed while the worker manifest stays keyed by the handle the IR
 * actually references.
 */
import type { CachedImage, RenderItem } from '@varve/engine';
import {
  getImageCache,
  isImageResourceHandle,
  resolveImageResourceHandle,
  walkTableCellContents,
} from '@varve/engine';
import { checkFault } from './faultInjection';
import { estimateRgbaBytes } from './renderBitmapBudget';

/**
 * Close every distinct ImageBitmap in a map.
 */
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
 * without its mask. Rich scene content compiled into table cells (images
 * inside cells) is walked as well — a worker frame without those bitmaps
 * would replay the cells as permanent gray placeholders.
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
    walkTableCellContents(item, (content) => {
      for (const contentFill of content.fills ?? []) {
        if (contentFill.type === 'image' && contentFill.src && contentFill.visible !== false) {
          srcs.add(contentFill.src);
          if (fillHasAlphaMask(contentFill)) srcs.add(String(contentFill.alphaMask));
        }
      }
    });
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
 * fills — including masked images compiled into table cells — are refused
 * here and stay on the main-thread path.
 */
export function irHasUnsupportedWorkerMasks(ir: RenderItem[]): boolean {
  for (const item of ir) {
    for (const fill of item.fills ?? []) {
      if (fill.type === 'image' && fill.visible !== false && fillHasAlphaMask(fill)) return true;
    }
    const fill = item.fill as unknown as Record<string, unknown> | undefined;
    if (fill && typeof fill === 'object' && fill.type === 'image' && fillHasAlphaMask(fill)) {
      return true;
    }
    let masked = false;
    walkTableCellContents(item, (content) => {
      if (masked) return;
      for (const contentFill of content.fills ?? []) {
        if (
          contentFill.type === 'image' &&
          contentFill.visible !== false &&
          fillHasAlphaMask(contentFill)
        ) {
          masked = true;
          return;
        }
      }
    });
    if (masked) return true;
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
  /**
   * Viewport-sufficient long-edge cap (px) for large embedded sources: the
   * at-size representation is decoded instead of the full-res bitmap, so a
   * 48 MP photo becomes a ~2-4K transferable bitmap that fits the worker
   * admission budget. Full-res entries stay untouched for export and
   * main-thread replay; zooming past the cap raises the cap and the cache
   * stamp re-render picks up the sharper representation.
   */
  maxSourceDim?: number;
}

/**
 * Why a frame's image payload cannot be handed to the render worker.
 *
 * `masked` and `unresolvable-source` are properties of the scene; `source-count`
 * is a transport budget. All three are decidable synchronously, which is what
 * makes them usable as a paint-path gate: the frame can choose the authoritative
 * main-thread replay *before* it commits to compositing a worker bitmap, instead
 * of discovering the refusal inside an async `collectImageBitmaps` continuation
 * that lands after the surface has already been painted.
 */
export type WorkerImageRefusal = 'masked' | 'unresolvable-source' | 'source-count';

export interface WorkerImageAdmissionOptions {
  /** Max distinct sources this frame may transfer (residents excluded). */
  maxEntries?: number;
  /** Sources the current worker generation can already draw without transfer. */
  residentSources?: ReadonlySet<string>;
}

/**
 * Synchronous admission decision for a frame's worker image payload.
 *
 * Returns `null` when the worker may render the frame, otherwise the refusal
 * reason. `collectImageBitmaps` consults the same function, so the paint gate
 * and the transfer path can never disagree about whether a worker frame is
 * coming.
 *
 * The source-count budget applies to sources that actually need transferring:
 * counting residents too would refuse a fully-resident scene forever, and a
 * refused frame transfers nothing, so residency could never grow past the cap.
 */
export function admitWorkerImagePayload(
  ir: RenderItem[],
  options: WorkerImageAdmissionOptions = {},
): WorkerImageRefusal | null {
  const srcs = imageSrcsFromIr(ir);
  if (srcs.length === 0) return null;
  if (irHasUnsupportedWorkerMasks(ir)) return 'masked';
  if (resolveSourcesForLoad(srcs) === null) return 'unresolvable-source';
  const maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
  const resident = options.residentSources;
  let needsTransfer = 0;
  for (const src of srcs) {
    if (!resident?.has(src)) needsTransfer += 1;
  }
  if (needsTransfer > maxEntries) return 'source-count';
  return null;
}

/** Source pixel dims of an IR image fill (displayed, orientation-normalized). */
function fillSourceDims(fill: Record<string, unknown>): { width: number; height: number } | null {
  const width = Number(fill.imageWidth) || 0;
  const height = Number(fill.imageHeight) || 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Viewport-sufficient long-edge cap (px) for worker source bitmaps: the
 * viewport's max dimension x DPR x zoom (floored at 1 for zoomed-out fit
 * views) with ~25% overscan, rounded up to the next power of two so zooming
 * around a cap boundary cannot thrash between representations. Returns 0
 * for small scenes, keeping the exact full-res path untouched.
 */
export function workerSourceCapFor(viewportMaxDim: number, dpr: number, zoom: number): number {
  const raw = viewportMaxDim * dpr * Math.max(zoom, 1) * 1.25;
  const cap = 2 ** Math.ceil(Math.log2(raw));
  return cap < 2048 ? 0 : Math.min(cap, 8192);
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
  // Single decision point for every synchronous refusal (masked fills the
  // worker cannot composite, unregistered handles, transport budget) so the
  // caller's paint gate and this transfer path always agree.
  if (admitWorkerImagePayload(ir, options) !== null) return null;

  const resolved = resolveSourcesForLoad(srcs) as string[];

  const cache = getImageCache();
  const images: Record<string, ImageBitmap> = {};
  const transfer: Transferable[] = [];
  let bytes = 0;

  // Map IR identity -> source pixel dims (for at-size representation). IR
  // fill stacks carry the dims on image fills; unknown dims fall back to the
  // full-res path.
  const sourceDims = new Map<string, { width: number; height: number }>();
  const collectDims = (fill: Record<string, unknown>, identity: string): void => {
    if (sourceDims.has(identity)) return;
    const dims = fillSourceDims(fill);
    if (dims) sourceDims.set(identity, dims);
  };
  for (const item of ir) {
    for (const fill of item.fills ?? []) {
      if (fill.type === 'image' && fill.src && fill.visible !== false) {
        collectDims(fill as unknown as Record<string, unknown>, String(fill.src));
      }
    }
    walkTableCellContents(item, (content) => {
      for (const fill of content.fills ?? []) {
        if (fill.type === 'image' && fill.src && fill.visible !== false) {
          collectDims(fill as unknown as Record<string, unknown>, String(fill.src));
        }
      }
    });
  }

  const fail = (): null => {
    closeImageBitmapMap(images);
    return null;
  };

  for (let i = 0; i < srcs.length; i += 1) {
    const identity = srcs[i] as string;
    const loadable = resolved[i] as string;
    if (options.residentSources?.has(identity)) continue;
    const dims = sourceDims.get(identity) ?? null;
    const useAtSize =
      options.maxSourceDim !== undefined &&
      cache.isRepresentationCapable(loadable) &&
      dims !== null &&
      Math.max(dims.width, dims.height) > options.maxSourceDim;
    let img: CachedImage | null = null;
    if (useAtSize) {
      img = cache.getImageAtSize(loadable, options.maxSourceDim as number);
      if (!img) {
        void cache
          .loadAtSize(loadable, options.maxSourceDim as number, dims ?? undefined)
          .catch(() => undefined);
        return fail();
      }
    } else {
      if (!cache.isLoaded(loadable)) {
        void cache.load(loadable).catch(() => undefined);
        return fail();
      }
      img = cache.getImage(loadable);
    }
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
