/**
 * Animated media pipeline — public API.
 *
 * Ownership chain (resource lifecycle):
 *   provider decodes → scheduler composites → frame cache owns RGBA +
 *   lazily-promoted ImageBitmap → eviction/dispose closes bitmaps. No
 *   double-close; no leak; stale results never present.
 */

import { type MediaCheckpointOptions, MediaCheckpointStore } from './checkpoints';
import { MediaFrameCache, type MediaFrameCacheOptions } from './frameCache';
import {
  dispatchDecode,
  type MediaDecoderProvider,
  mediaProviderChain,
} from './providers/dispatch';
import { AnimatedMediaSession, type MediaSessionOptions } from './session';
import type { AnimatedImageMetadata } from './types';

export { MediaCheckpointStore } from './checkpoints';
export {
  type CompositeState,
  compositeAll,
  compositeRange,
  createCompositeState,
} from './compositor';
export {
  disableMediaDiagnostics,
  enableMediaDiagnostics,
  mediaDiagnosticsEnabled,
  snapshotMediaDiagnostics,
} from './diagnostics';
export {
  createBitmapFromRgba,
  estimateFrameBytes,
  MediaFrameCache,
  mediaFrameCacheKey,
} from './frameCache';
export {
  buildFrameTiming,
  type FrameTiming,
  frameIndexForTime,
  timeForFrame,
  visibleDurationMs,
} from './frameResolver';
export { resolveUsageFrame, usageTiming } from './playback';
export { probeAnimatedMedia } from './probe';
export {
  dispatchDecode,
  imageDecoderProvider,
  mediaProviderChain,
  nativeMediaProvider,
  tsGifMediaProvider,
  wasmMediaProvider,
} from './providers/dispatch';
export type { MediaDecoderProvider } from './providers/types';
export { MediaFrameScheduler } from './scheduler';
export { AnimatedMediaSession, type RequestFrameOptions } from './session';
export { decodeGifFrames, expandToRgba, GifDecodeError, lzwDecode } from './tsGif';
export * from './types';
export { MediaProbeError } from './types';

export interface MediaRegistryOptions {
  cache?: Partial<MediaFrameCacheOptions>;
  checkpoints?: Partial<MediaCheckpointOptions>;
  providers?: MediaDecoderProvider[];
  /** Frames/bytes defaults: cache 64 MiB, checkpoints 8 MiB, stride 32. */
}

export interface MediaRegistryStats {
  sessions: number;
  cacheEntries: number;
  cacheBytes: number;
  checkpointEntries: number;
  checkpointBytes: number;
}

/**
 * Per-asset session registry. Sessions are keyed by asset id (shared by all
 * usages); closing a document drops its sessions (bitmap closure included).
 */
export class MediaRegistry {
  private sessions = new Map<string, AnimatedMediaSession>();
  readonly cache: MediaFrameCache;
  readonly checkpoints: MediaCheckpointStore;
  private providers: MediaDecoderProvider[];

  constructor(options: MediaRegistryOptions = {}) {
    this.cache = new MediaFrameCache({
      maxBytes: options.cache?.maxBytes ?? 64 * 1024 * 1024,
    });
    this.checkpoints = new MediaCheckpointStore({
      stride: options.checkpoints?.stride ?? 32,
      maxBytes: options.checkpoints?.maxBytes ?? 8 * 1024 * 1024,
    });
    this.providers = options.providers ?? mediaProviderChain();
  }

  get stats(): MediaRegistryStats {
    return {
      sessions: this.sessions.size,
      cacheEntries: this.cache.size,
      cacheBytes: this.cache.stats.bytes,
      checkpointEntries: this.checkpoints.stats.entries,
      checkpointBytes: this.checkpoints.stats.bytes,
    };
  }

  get(id: string): AnimatedMediaSession | undefined {
    return this.sessions.get(id);
  }

  /** Get or create a session for an asset (dedup by asset id + bytes). */
  acquire(id: string, bytes: Uint8Array, metadata: AnimatedImageMetadata): AnimatedMediaSession {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const session = new AnimatedMediaSession(id, bytes, metadata, this.sessionOptions());
    this.sessions.set(id, session);
    return session;
  }

  release(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.dispose();
    this.sessions.delete(id);
    this.cache.clearForAsset(id);
    this.checkpoints.clear(id);
  }

  clear(): void {
    for (const id of [...this.sessions.keys()]) this.release(id);
    this.cache.clear();
    this.checkpoints.clear();
  }

  private sessionOptions(): MediaSessionOptions {
    const chain = this.providers;
    return {
      cache: this.cache,
      checkpoints: this.checkpoints,
      decodeFrames: (bytes, range, format, signal) =>
        dispatchDecode(chain, bytes, range, format, signal),
    };
  }
}

/** Global singleton registry for the application. */
let globalRegistry: MediaRegistry | null = null;

export function getMediaRegistry(): MediaRegistry {
  if (!globalRegistry) globalRegistry = new MediaRegistry();
  return globalRegistry;
}

export function resetMediaRegistry(): void {
  globalRegistry?.clear();
  globalRegistry = null;
}
