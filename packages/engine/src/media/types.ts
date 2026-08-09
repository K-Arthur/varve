/**
 * Animated image media types shared across the media pipeline.
 *
 * Model contract: the original encoded bytes are authoritative; `metadata`
 * is probed from the container (never the browser); decoded/composited
 * frames are disposable cache state. Timing is always milliseconds; source
 * frame durations are preserved exactly (GIF centiseconds x10, APNG num/den,
 * WebP ms) — never snapped to a UI step.
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
 * (schema 2.19). All fields are probed from the encoded bytes.
 */
export interface AnimatedImageMetadata {
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

/** One decoded source frame (rect-sized RGBA) from a provider. */
export interface DecodedSourceFrame {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  blend: MediaBlend;
  disposal: MediaDisposal;
  preComposited: boolean;
  /** Rect-sized RGBA (width*height*4). */
  rgba: Uint8Array;
}

/** A full-canvas composited frame (cache payload). */
export interface CompositedFrame {
  frameIndex: number;
  width: number;
  height: number;
  /** Canvas-sized RGBA (width*height*4). */
  rgba: Uint8Array;
}

/** Result of mapping a global time to a media frame. */
export interface ResolvedMediaFrame {
  frameIndex: number;
  /** 0-based loop iteration. */
  iteration: number;
  /** Direction of playback at this time (rate >= 0 → 1, else -1). */
  direction: 1 | -1;
  /** True when playback has exhausted the window (once/finite-source). */
  atEnd: boolean;
  /** Time within the trimmed source window (ms). */
  windowMs: number;
}

export interface MediaProbeResult {
  /** `null` = unrecognized container; `'static'` = recognized but not animated. */
  kind: MediaFormat | 'static' | null;
  metadata?: AnimatedImageMetadata;
  /** Content-sniffed MIME (independent of the file extension). */
  mime: string;
}

export type MediaProbeErrorKind =
  | 'too-small'
  | 'unrecognized'
  | 'truncated'
  | 'invalid-header'
  | 'unsupported'
  | 'limits';

export class MediaProbeError extends Error {
  readonly kind: MediaProbeErrorKind;
  constructor(kind: MediaProbeErrorKind, message: string) {
    super(message);
    this.name = 'MediaProbeError';
    this.kind = kind;
  }
}

export interface MediaDecodeLimits {
  maxDimension: number;
  maxPixelsPerFrame: number;
  maxFrames: number;
  maxDecodedBytes: number;
  maxEncodedBytes: number;
}

export const MEDIA_DECODE_LIMITS: MediaDecodeLimits = {
  maxDimension: 65_535,
  maxPixelsPerFrame: 64 * 1024 * 1024,
  maxFrames: 10_000,
  maxDecodedBytes: 512 * 1024 * 1024,
  maxEncodedBytes: 128 * 1024 * 1024,
};

/** Version bump gate: changing this invalidates every cached frame. */
export const MEDIA_DECODER_VERSION = 1;
