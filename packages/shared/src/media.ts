/**
 * Animated media vocabulary — serializable types shared by the scene model,
 * the engine pipeline, and import/export.
 *
 * `AnimatedAssetMetadata` is probed from container bytes (never the browser)
 * and persisted on `DocumentAsset.animated` (schema 2.20+). `MediaFillSettings`
 * are per-usage playback overrides stored on `ImageFillData.media`; playback
 * state (current time, playing) is runtime editor state and never serialized.
 *
 * Timing is always milliseconds; source frame durations are preserved
 * exactly (GIF centiseconds x10, APNG num/den, WebP ms).
 */

export type MediaFormat = 'gif' | 'apng' | 'webp';

export type MediaBlend = 'source' | 'over';
export type MediaDisposal = 'none' | 'background' | 'previous';

/** Loop policy per usage. `source` honors the container loop count. */
export type MediaLoopMode = 'source' | 'once' | 'loop' | 'pingpong';

export interface AnimatedFrameMetadata {
  /** Frame index in the source sequence. */
  index: number;
  /** Source-timing duration in ms. May be 0 (zero-delay frames). */
  durationMs: number;
  /** Frame rectangle within the animation canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  blend: MediaBlend;
  disposal: MediaDisposal;
  /**
   * True when the underlying decoder emits pre-composited full canvases
   * (WebP, Chromium ImageDecoder) — the compositor pastes them verbatim.
   */
  preComposited?: boolean;
}

/**
 * Container-level animation facts persisted on `DocumentAsset.animated`
 * (schema 2.20+). All fields are probed from the encoded bytes; the original
 * bytes stay authoritative.
 */
export interface AnimatedAssetMetadata {
  kind: MediaFormat;
  frameCount: number;
  /** Sum of frame durations in ms (pre-trim). */
  durationMs: number;
  /** `'infinite'` or a finite loop count from the container. */
  loopCount: number | 'infinite';
  /** Animation canvas size — NOT per-frame rects. */
  width: number;
  height: number;
  frames: AnimatedFrameMetadata[];
  /**
   * Bump when decode/composition semantics change; part of cache keys so
   * stale cached frames can never be served after a semantic upgrade.
   */
  decoderVersion: number;
}

/** Per-usage playback settings stored on `ImageFillData.media`. */
export interface MediaFillSettings {
  loopMode: MediaLoopMode;
  /** Playback speed multiplier; negative = reverse. */
  rate: number;
  /** Global-time offset at which media time begins. */
  startOffsetMs: number;
  /** Media-time trim window (source-media ms). */
  inPointMs: number;
  outPointMs: number;
  /** Static-export / thumbnail poster frame index. */
  posterFrame: number;
}

export function defaultMediaFillSettings(): MediaFillSettings {
  return {
    loopMode: 'source',
    rate: 1,
    startOffsetMs: 0,
    inPointMs: 0,
    outPointMs: 0, // resolved to metadata.durationMs when 0
    posterFrame: 0,
  };
}
