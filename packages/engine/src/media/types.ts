/**
 * Animated image media types shared across the media pipeline.
 *
 * Model contract: the original encoded bytes are authoritative; `metadata`
 * is probed from the container (never the browser); decoded/composited
 * frames are disposable cache state. Timing is always milliseconds; source
 * frame durations are preserved exactly (GIF centiseconds x10, APNG num/den,
 * WebP ms) — never snapped to a UI step.
 */

import type { AnimatedAssetMetadata, MediaBlend, MediaDisposal, MediaFormat } from '@varve/shared';

export type {
  AnimatedAssetMetadata,
  AnimatedFrameMetadata,
  MediaBlend,
  MediaDisposal,
  MediaFillSettings,
  MediaFormat,
  MediaLoopMode,
} from '@varve/shared';
export { defaultMediaFillSettings } from '@varve/shared';

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
  metadata?: AnimatedAssetMetadata;
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
