/**
 * Composited-frame checkpoint store.
 *
 * Seeking to frame N must not replay frames 0..N-1 from scratch; a
 * checkpoint is the post-disposal composite state at a frame boundary (the
 * state the next frame draws on). The store is byte-budgeted (shared across
 * assets), LRU-evicted, and disposable — checkpoints are derived cache
 * state, never serialized.
 */

import type { CompositeState } from './compositor';
import { estimateFrameBytes } from './frameCache';

export interface MediaCheckpointOptions {
  /** Stride: a checkpoint is kept at frame indices divisible by this. */
  stride: number;
  /** Shared byte budget across all assets. */
  maxBytes: number;
}

export interface MediaCheckpointStats {
  entries: number;
  bytes: number;
  evictions: number;
}

export class MediaCheckpointStore {
  private store = new Map<string, CompositeState>();
  private maxBytes: number;
  readonly stride: number;
  private retainedBytes = 0;
  private evictions = 0;

  constructor(options: MediaCheckpointOptions) {
    this.stride = Math.max(1, options.stride);
    this.maxBytes = Math.max(1, options.maxBytes);
  }

  get stats(): MediaCheckpointStats {
    return { entries: this.store.size, bytes: this.retainedBytes, evictions: this.evictions };
  }

  /** Checkpoint key: assetId + checkpoint frame index. */
  key(assetId: string, frameIndex: number): string {
    return `${assetId}:${frameIndex}`;
  }

  /** Nearest checkpoint at or before `frameIndex`, or undefined. */
  nearest(
    assetId: string,
    frameIndex: number,
  ): { frameIndex: number; state: CompositeState } | undefined {
    let i = frameIndex - (frameIndex % this.stride);
    for (; i >= 0; i -= this.stride) {
      const state = this.store.get(this.key(assetId, i));
      if (state) return { frameIndex: i, state };
    }
    return undefined;
  }

  /** Store a post-disposal state at `frameIndex` (kept when index % stride === 0). */
  put(assetId: string, frameIndex: number, state: CompositeState): void {
    if (frameIndex % this.stride !== 0) return;
    const bytes = estimateFrameBytes(state.width, state.height);
    const existing = this.store.get(this.key(assetId, frameIndex));
    if (existing) {
      // replace in place (same size)
      this.store.set(this.key(assetId, frameIndex), state);
      return;
    }
    this.store.set(this.key(assetId, frameIndex), state);
    this.retainedBytes += bytes;
    this.evictIfNeeded();
  }

  clear(assetId?: string): void {
    if (assetId === undefined) {
      this.store.clear();
      this.retainedBytes = 0;
      return;
    }
    const prefix = `${assetId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        const state = this.store.get(key);
        if (state)
          this.retainedBytes = Math.max(
            0,
            this.retainedBytes - estimateFrameBytes(state.width, state.height),
          );
        this.store.delete(key);
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.retainedBytes > this.maxBytes && this.store.size > 0) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const state = this.store.get(oldestKey);
      if (state) {
        this.retainedBytes = Math.max(
          0,
          this.retainedBytes - estimateFrameBytes(state.width, state.height),
        );
        this.evictions++;
      }
      this.store.delete(oldestKey);
    }
  }
}
