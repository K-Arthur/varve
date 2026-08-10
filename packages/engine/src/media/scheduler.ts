/**
 * Media frame scheduler — decode/composite request coordination.
 *
 * Responsibilities:
 *  - in-flight dedup: two usages of the same asset at the same frame share
 *    one decode+composite job
 *  - generation tokens per asset: a stale result can never present itself
 *    (latest request wins; the cache write of a stale frame is harmless —
 *    it is keyed by frame index — but its `onReady` is discarded)
 *  - checkpoint-resume: seeks start from the nearest cached composite state
 *  - direction-aware prefetch of neighbors (bounded, low priority)
 *  - abort signals per request; scrub batching (no decode storm)
 */

import type { MediaCheckpointStore } from './checkpoints';
import { type CompositeState, compositeRange } from './compositor';
import { type MediaFrameCache, mediaFrameCacheKey } from './frameCache';
import type { AnimatedAssetMetadata, CompositedFrame, DecodedSourceFrame } from './types';

export interface MediaSchedulerAsset {
  id: string;
  bytes: Uint8Array;
  metadata: AnimatedAssetMetadata;
}

export interface MediaSchedulerDeps {
  cache: MediaFrameCache;
  checkpoints: MediaCheckpointStore;
  decodeFrames: (
    bytes: Uint8Array,
    range: { start: number; end: number },
    signal?: AbortSignal,
  ) => Promise<DecodedSourceFrame[]>;
}

export interface RequestFrameOptions {
  signal?: AbortSignal;
  /** Called (once) when the requested composited frame is ready. */
  onReady?: (frame: CompositedFrame) => void;
  /** 0 = critical (displayed now), higher = more deferrable. */
  priority?: number;
  /** Playback direction for neighbor prefetch (default 1). */
  direction?: 1 | -1;
  /** Disable neighbor prefetch (tests, scrubbing storms). */
  prefetch?: boolean;
}

export interface MediaSchedulerStats {
  inFlight: number;
  deduplicated: number;
  staleDiscarded: number;
  cancelled: number;
}

const PREFETCH_LIMIT = 2;

export class MediaFrameScheduler {
  private deps: MediaSchedulerDeps;
  private inFlight = new Map<string, Promise<CompositedFrame>>();
  private tokens = new Map<string, number>();
  private deduplicated = 0;
  private staleDiscarded = 0;
  private cancelled = 0;

  constructor(deps: MediaSchedulerDeps) {
    this.deps = deps;
  }

  get stats(): MediaSchedulerStats {
    return {
      inFlight: this.inFlight.size,
      deduplicated: this.deduplicated,
      staleDiscarded: this.staleDiscarded,
      cancelled: this.cancelled,
    };
  }

  /** Bump the generation for an asset, cancelling stale presentation. */
  invalidate(assetId: string): void {
    this.tokens.set(assetId, (this.tokens.get(assetId) ?? 0) + 1);
  }

  /**
   * Resolve the composited frame at `frameIndex`. Cache-first; otherwise
   * decode from the nearest checkpoint and composite, caching every
   * displayed state in the range and checkpointing at stride boundaries.
   */
  requestFrame(
    asset: MediaSchedulerAsset,
    frameIndex: number,
    options: RequestFrameOptions = {},
  ): Promise<CompositedFrame> {
    const { cache } = this.deps;
    const key = mediaFrameCacheKey({
      assetId: asset.id,
      frameIndex,
      decoderVersion: asset.metadata.decoderVersion,
      width: asset.metadata.width,
      height: asset.metadata.height,
    });
    const existing = cache.get(key);
    if (existing) {
      const frame: CompositedFrame = {
        frameIndex: existing.frameIndex,
        width: existing.width,
        height: existing.height,
        rgba: existing.rgba,
      };
      options.onReady?.(frame);
      return Promise.resolve(frame);
    }
    if (options.signal?.aborted) return Promise.reject(new Error('cancelled'));

    const existingJob = this.inFlight.get(key);
    if (existingJob) {
      this.deduplicated++;
      return existingJob.then((frame) => {
        if (!options.signal?.aborted) options.onReady?.(frame);
        return frame;
      });
    }

    const token = this.tokens.get(asset.id) ?? 0;
    const job = this.decodeAndComposite(asset, frameIndex, key, token, options).then(
      (frame) => {
        this.inFlight.delete(key);
        if ((this.tokens.get(asset.id) ?? 0) !== token) {
          // stale: the asset was invalidated while decoding — do not present
          this.staleDiscarded++;
          throw new Error('stale');
        }
        if (options.signal?.aborted) throw new Error('cancelled');
        options.onReady?.(frame);
        if (options.prefetch !== false) this.schedulePrefetch(asset, frameIndex, options);
        return frame;
      },
      (error) => {
        this.inFlight.delete(key);
        throw error;
      },
    );
    this.inFlight.set(key, job);
    return job;
  }

  /** Cancel everything in flight for an asset (seek/trim/close). */
  cancelAsset(assetId: string): void {
    this.invalidate(assetId);
    this.inFlight.clear();
    this.cancelled++;
  }

  private async decodeAndComposite(
    asset: MediaSchedulerAsset,
    frameIndex: number,
    key: string,
    token: number,
    options: RequestFrameOptions,
  ): Promise<CompositedFrame> {
    const { cache, checkpoints, decodeFrames } = this.deps;
    const metadata = asset.metadata;

    const checkpoint = checkpoints.nearest(asset.id, frameIndex);
    const startFrame = checkpoint ? checkpoint.frameIndex + 1 : 0;

    if ((this.tokens.get(asset.id) ?? 0) !== token) throw new Error('stale');
    const sources = await decodeFrames(
      asset.bytes,
      { start: startFrame, end: frameIndex },
      options.signal,
    );
    if ((this.tokens.get(asset.id) ?? 0) !== token) throw new Error('stale');

    const { states, finalState } = compositeRange(checkpoint?.state, sources);
    if (states.length === 0) {
      throw new Error(`media: no frames decoded for ${asset.id} frame ${frameIndex}`);
    }
    // cache every displayed state in the range (bounded by the LRU budget)
    let last: CompositedFrame | undefined;
    for (const state of states) {
      const frame: CompositedFrame = {
        frameIndex: state.frameIndex,
        width: metadata.width,
        height: metadata.height,
        rgba: state.rgba,
      };
      cache.set(
        mediaFrameCacheKey({
          assetId: asset.id,
          frameIndex: state.frameIndex,
          decoderVersion: metadata.decoderVersion,
          width: metadata.width,
          height: metadata.height,
        }),
        frame,
      );
      if (state.frameIndex === frameIndex) last = frame;
    }
    // checkpoint the post-disposal state at the end of the range
    const finalStateCopy: CompositeState = {
      frameIndex,
      width: finalState.width,
      height: finalState.height,
      rgba: new Uint8Array(finalState.rgba),
    };
    checkpoints.put(asset.id, frameIndex, finalStateCopy);
    if (!last) throw new Error('media: decode range did not cover the requested frame');
    void key;
    return last;
  }

  private schedulePrefetch(
    asset: MediaSchedulerAsset,
    current: number,
    options: RequestFrameOptions,
  ): void {
    const frameCount = asset.metadata.frameCount;
    const direction = options.direction ?? 1;
    for (let i = 1; i <= PREFETCH_LIMIT; i++) {
      const next = current + direction * i;
      if (next < 0 || next >= frameCount) continue;
      const key = mediaFrameCacheKey({
        assetId: asset.id,
        frameIndex: next,
        decoderVersion: asset.metadata.decoderVersion,
        width: asset.metadata.width,
        height: asset.metadata.height,
      });
      if (this.deps.cache.peek(key)) continue;
      void this.requestFrame(asset, next, {
        priority: (options.priority ?? 0) + i,
        signal: options.signal,
      }).catch(() => {});
    }
  }
}
