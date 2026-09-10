/**
 * Byte-budgeted LRU cache of composited media frames.
 *
 * Entries hold full-canvas RGBA bytes plus an optional lazily-promoted
 * `ImageBitmap` for main-thread rendering (promotion is DOM-only; node tests
 * exercise the RGBA path). Budgets are byte-based (width × height × 4 + 64
 * per entry), matching memory-pressure profiles; eviction closes owned
 * bitmaps. Subscribers per key are notified when a frame arrives — the
 * redraw trigger for the canvas.
 */

import type { CompositedFrame } from './types';

export interface MediaFrameCacheEntry {
  key: string;
  frameIndex: number;
  width: number;
  height: number;
  rgba: Uint8Array;
  bitmap: ImageBitmap | null;
  bytes: number;
}

export interface MediaFrameCacheOptions {
  maxBytes: number;
}

export interface MediaFrameCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
  bitmapClosures: number;
  rejectedOversize: number;
}

const ENTRY_OVERHEAD_BYTES = 64;

/**
 * Cache identity: asset bytes hash + frame index + decoder version + decode
 * size + color policy. Never key by node id or bare frame index.
 */
export function mediaFrameCacheKey(opts: {
  assetId: string;
  frameIndex: number;
  decoderVersion: number;
  width: number;
  height: number;
  colorPolicy?: string;
}): string {
  return [
    opts.assetId,
    opts.frameIndex,
    opts.decoderVersion,
    opts.width,
    opts.height,
    opts.colorPolicy ?? 'srgb',
  ].join(':');
}

export function estimateFrameBytes(width: number, height: number): number {
  return width * height * 4 + ENTRY_OVERHEAD_BYTES;
}

export class MediaFrameCache {
  private entries = new Map<string, MediaFrameCacheEntry>();
  private listeners = new Map<string, Set<() => void>>();
  private maxBytes: number;
  private retainedBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private bitmapClosures = 0;
  private rejectedOversize = 0;

  constructor(options: MediaFrameCacheOptions) {
    this.maxBytes = Math.max(1, options.maxBytes);
  }

  get size(): number {
    return this.entries.size;
  }

  get stats(): MediaFrameCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.retainedBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      bitmapClosures: this.bitmapClosures,
      rejectedOversize: this.rejectedOversize,
    };
  }

  setLimits(maxBytes: number): void {
    this.maxBytes = Math.max(1, maxBytes);
    this.evictIfNeeded();
  }

  get(key: string): MediaFrameCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, entry); // LRU touch
    } else {
      this.misses++;
    }
    return entry;
  }

  /** Get without touching LRU order or stats (probe path). */
  peek(key: string): MediaFrameCacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, frame: CompositedFrame): MediaFrameCacheEntry {
    const bytes = estimateFrameBytes(frame.width, frame.height);
    if (bytes > this.maxBytes) {
      // Oversize single frames are served transiently by the caller, never
      // retained — but count and notify so presentation still happens.
      this.rejectedOversize++;
      this.entries.delete(key);
      this.notify(key);
      return {
        key,
        frameIndex: frame.frameIndex,
        width: frame.width,
        height: frame.height,
        rgba: frame.rgba,
        bitmap: null,
        bytes,
      };
    }
    const previous = this.entries.get(key);
    if (previous?.bitmap) {
      previous.bitmap.close();
      this.bitmapClosures++;
    }
    const entry: MediaFrameCacheEntry = {
      key,
      frameIndex: frame.frameIndex,
      width: frame.width,
      height: frame.height,
      rgba: frame.rgba,
      bitmap: null,
      bytes,
    };
    this.entries.set(key, entry);
    this.retainedBytes += bytes;
    this.evictIfNeeded();
    this.notify(key);
    return entry;
  }

  /**
   * Promote an entry to hold a renderable ImageBitmap (main thread only).
   * Sync variant: OffscreenCanvas path only (the replay hot path). Returns
   * null in DOM-free environments or when promotion is asynchronous.
   */
  ensureBitmapSync(key: string): ImageBitmap | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.bitmap) return entry.bitmap;
    const bitmap = createBitmapSyncFromRgba(entry.rgba, entry.width, entry.height);
    if (bitmap) entry.bitmap = bitmap;
    return bitmap;
  }

  /**
   * Async promote (DOM canvas fallback). Callers must not close the
   * returned bitmap — the cache owns it and closes it on eviction.
   */
  async ensureBitmap(key: string): Promise<ImageBitmap | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.bitmap) return entry.bitmap;
    const bitmap = await createBitmapFromRgba(entry.rgba, entry.width, entry.height);
    if (bitmap) entry.bitmap = bitmap;
    return bitmap;
  }

  evict(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.retainedBytes = Math.max(0, this.retainedBytes - entry.bytes);
    if (entry.bitmap) {
      entry.bitmap.close();
      this.bitmapClosures++;
    }
  }

  /** Evict every entry whose key starts with the given asset id. */
  clearForAsset(assetId: string): void {
    const prefix = `${assetId}:`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.evict(key);
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.bitmap) {
        entry.bitmap.close();
        this.bitmapClosures++;
      }
    }
    this.entries.clear();
    this.retainedBytes = 0;
    this.listeners.clear();
  }

  subscribe(key: string, callback: () => void): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)?.add(callback);
    return () => {
      const set = this.listeners.get(key);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(key);
      }
    };
  }

  private globalListeners = new Set<() => void>();

  subscribeGlobal(callback: () => void): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  private notify(key: string): void {
    const set = this.listeners.get(key);
    if (set) for (const cb of set) cb();
    for (const cb of this.globalListeners) cb();
  }

  private evictIfNeeded(): void {
    while (this.retainedBytes > this.maxBytes && this.entries.size > 0) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.evict(oldestKey);
      this.evictions++;
    }
  }
}

/** Sync ImageBitmap creation via OffscreenCanvas (no DOM dependency). */
export function createBitmapSyncFromRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
): ImageBitmap | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return canvas.transferToImageBitmap();
    }
  } catch {
    // environment without bitmap support — RGBA path still works
  }
  return null;
}

/** Async ImageBitmap creation (DOM canvas fallback). */
export async function createBitmapFromRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<ImageBitmap | null> {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return canvas.transferToImageBitmap();
    }
    if (typeof document !== 'undefined' && typeof createImageBitmap === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return await createImageBitmap(canvas);
    }
  } catch {
    // environment without bitmap support — RGBA path still works
  }
  return null;
}
