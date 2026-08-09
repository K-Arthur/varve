/**
 * Animated media session — per-asset binding of bytes + metadata + timing +
 * provider + cache + checkpoints + scheduler.
 *
 * A session is created once per unique asset and shared by every usage (the
 * editor registry keys sessions by asset id, never by node). Playback
 * settings stay on usages; sessions only know the asset.
 */

import type { MediaCheckpointStore } from './checkpoints';
import { type MediaFrameCache, mediaFrameCacheKey } from './frameCache';
import type { FrameTiming } from './frameResolver';
import { usageTiming } from './playback';
import { MediaFrameScheduler } from './scheduler';
import type { AnimatedAssetMetadata, CompositedFrame, DecodedSourceFrame } from './types';

export interface MediaSessionOptions {
  cache: MediaFrameCache;
  checkpoints: MediaCheckpointStore;
  /** Provider chain wrapper — falls through providers until one decodes. */
  decodeFrames: (
    bytes: Uint8Array,
    range: { start: number; end: number },
    format: import('./types').MediaFormat,
    signal?: AbortSignal,
  ) => Promise<DecodedSourceFrame[]>;
}

export interface RequestFrameOptions {
  signal?: AbortSignal;
  onReady?: (frame: CompositedFrame) => void;
  priority?: number;
  direction?: 1 | -1;
  /** Disable neighbor prefetch (tests, scrubbing storms). */
  prefetch?: boolean;
}

export class AnimatedMediaSession {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly metadata: AnimatedAssetMetadata;
  readonly timing: FrameTiming;
  private readonly scheduler: MediaFrameScheduler;
  private readonly cache: MediaFrameCache;
  private disposed = false;

  constructor(
    id: string,
    bytes: Uint8Array,
    metadata: AnimatedAssetMetadata,
    options: MediaSessionOptions,
  ) {
    this.id = id;
    this.bytes = bytes;
    this.metadata = metadata;
    this.timing = usageTiming(metadata.frames);
    this.cache = options.cache;
    this.scheduler = new MediaFrameScheduler({
      cache: options.cache,
      checkpoints: options.checkpoints,
      decodeFrames: (b, range, signal) =>
        options.decodeFrames(b, range, this.metadata.kind, signal),
    });
  }

  private cacheKey(frameIndex: number): string {
    return mediaFrameCacheKey({
      assetId: this.id,
      frameIndex,
      decoderVersion: this.metadata.decoderVersion,
      width: this.metadata.width,
      height: this.metadata.height,
    });
  }

  /** Sync cache hit (the frame CanvasArea draws without awaiting). */
  getComposited(frameIndex: number): CompositedFrame | undefined {
    if (this.disposed) return undefined;
    return this.peekComposited(frameIndex);
  }

  /** Sync bitmap promotion (OffscreenCanvas only; null in DOM-free envs). */
  getBitmapSync(frameIndex: number): ImageBitmap | null {
    if (this.disposed) return null;
    const entry = this.cache.peek(this.cacheKey(frameIndex));
    if (!entry) return null;
    return this.cache.ensureBitmapSync(this.cacheKey(frameIndex));
  }

  /** Async bitmap promotion (DOM canvas fallback for non-Offscreen envs). */
  getBitmap(frameIndex: number): Promise<ImageBitmap | null> {
    if (this.disposed) return Promise.resolve(null);
    const entry = this.cache.peek(this.cacheKey(frameIndex));
    if (!entry) return Promise.resolve(null);
    return this.cache.ensureBitmap(this.cacheKey(frameIndex));
  }

  private peekComposited(frameIndex: number): CompositedFrame | undefined {
    const entry = this.cache.peek(this.cacheKey(frameIndex));
    if (!entry) return undefined;
    return {
      frameIndex: entry.frameIndex,
      width: entry.width,
      height: entry.height,
      rgba: entry.rgba,
    };
  }

  /** Resolve a composited frame, decoding/compositing on demand. */
  requestFrame(frameIndex: number, options: RequestFrameOptions = {}): Promise<CompositedFrame> {
    if (this.disposed) return Promise.reject(new Error('session disposed'));
    const clamped = Math.max(0, Math.min(this.metadata.frameCount - 1, frameIndex));
    return this.scheduler.requestFrame(
      { id: this.id, bytes: this.bytes, metadata: this.metadata },
      clamped,
      options,
    );
  }

  /** Invalidate in-flight work (seek/trim/close). */
  invalidate(): void {
    if (this.disposed) return;
    this.scheduler.invalidate(this.id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.cancelAsset(this.id);
  }
}
