/**
 * Video export — timeline frame loop + WebCodecs encode + MP4/WebM mux.
 *
 * Uses IR-replay via an injected frame renderer callback so this module
 * stays free of @strata/editor circular dependencies.
 *
 * Research basis: WebCodecs VideoEncoder, mp4-muxer / webm-muxer,
 * W3C Media Production API patterns.
 */

import { ArrayBufferTarget, Muxer as Mp4Muxer } from 'mp4-muxer';
import { Muxer as WebmMuxer } from 'webm-muxer';

export interface VideoTimelineRef {
  id: string;
  /** Duration in milliseconds. */
  duration: number;
}

export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  codec?: 'h264' | 'vp9';
  /** When true, export only the final frame (prefers-reduced-motion). */
  reducedMotion?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface VideoExportResult {
  bytes: Uint8Array | null;
  frameCount: number;
  supported: boolean;
  reason?: string;
  mimeType?: string;
}

export interface VideoExportSupport {
  supported: boolean;
  reason?: string;
}

export type VideoFrameRenderer = (
  timeMs: number,
  frameIndex: number,
) => Promise<ImageBitmap | Uint8Array>;

const H264_CODEC_CANDIDATES = ['avc1.42001E', 'avc1.4D401E', 'avc1.64001E'] as const;
const VP9_CODEC = 'vp09.00.10.08';

/** Compute the number of frames to encode. */
export function computeVideoFrameCount(
  durationMs: number,
  fps: number,
  reducedMotion = false,
): number {
  if (reducedMotion) return 1;
  const frames = Math.ceil((Math.max(durationMs, 0) / 1000) * fps);
  return Math.max(frames, 1);
}

/** Probe runtime support for WebCodecs video export. */
export function checkVideoExportSupport(): VideoExportSupport {
  if (typeof globalThis.VideoEncoder === 'undefined') {
    return { supported: false, reason: 'VideoEncoder API unavailable' };
  }
  const hasCanvas =
    typeof OffscreenCanvas !== 'undefined' || typeof HTMLCanvasElement !== 'undefined';
  if (!hasCanvas) {
    return { supported: false, reason: 'OffscreenCanvas unavailable' };
  }
  if (typeof globalThis.VideoFrame === 'undefined') {
    return { supported: false, reason: 'VideoFrame API unavailable' };
  }
  return { supported: true };
}

function frameDurationUs(fps: number): number {
  return Math.round(1_000_000 / fps);
}

function rgbaByteLength(width: number, height: number): number {
  return width * height * 4;
}

async function rgbaToVideoFrame(
  rgba: Uint8Array,
  width: number,
  height: number,
  timestampUs: number,
  durationUs: number,
): Promise<VideoFrame> {
  const expected = rgbaByteLength(width, height);
  if (rgba.byteLength < expected) {
    throw new Error(`Frame data too small: expected ${expected}, got ${rgba.byteLength}`);
  }
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : (() => {
          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          return c;
        })();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for video frame conversion');
  const clamped = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, expected);
  ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
  return new VideoFrame(canvas as CanvasImageSource, {
    timestamp: timestampUs,
    duration: durationUs,
  });
}

async function sourceToVideoFrame(
  source: ImageBitmap | Uint8Array,
  width: number,
  height: number,
  timestampUs: number,
  durationUs: number,
): Promise<VideoFrame> {
  if (source instanceof Uint8Array) {
    return rgbaToVideoFrame(source, width, height, timestampUs, durationUs);
  }
  const frame = new VideoFrame(source, { timestamp: timestampUs, duration: durationUs });
  source.close();
  return frame;
}

async function pickH264Codec(width: number, height: number, fps: number): Promise<string | null> {
  for (const codec of H264_CODEC_CANDIDATES) {
    const result = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: 2_000_000,
      framerate: fps,
    });
    if (result.supported) return codec;
  }
  return null;
}

async function pickVp9Codec(width: number, height: number, fps: number): Promise<boolean> {
  const result = await VideoEncoder.isConfigSupported({
    codec: VP9_CODEC,
    width,
    height,
    bitrate: 2_000_000,
    framerate: fps,
  });
  return result.supported;
}

interface EncoderSession {
  encodeFrame: (frame: VideoFrame, keyFrame: boolean) => void;
  flush: () => Promise<void>;
  close: () => void;
  mimeType: string;
  getBytes: () => Uint8Array;
}

async function createEncoderSession(
  options: VideoExportOptions,
): Promise<EncoderSession | { error: string }> {
  const { width, height, fps } = options;
  const preferH264 = options.codec !== 'vp9';

  if (preferH264) {
    const h264 = await pickH264Codec(width, height, fps);
    if (h264) {
      const target = new ArrayBufferTarget();
      const muxer = new Mp4Muxer({
        target,
        video: { codec: 'avc', width, height },
        fastStart: 'in-memory',
      });
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          throw e;
        },
      });
      encoder.configure({
        codec: h264,
        width,
        height,
        bitrate: 2_000_000,
        framerate: fps,
      });
      return {
        mimeType: 'video/mp4',
        encodeFrame: (frame, keyFrame) => encoder.encode(frame, { keyFrame }),
        flush: async () => {
          await encoder.flush();
          encoder.close();
          muxer.finalize();
        },
        close: () => encoder.close(),
        getBytes: () => new Uint8Array(target.buffer),
      };
    }
  }

  const vp9Ok = await pickVp9Codec(width, height, fps);
  if (!vp9Ok) {
    return { error: 'No supported H.264 or VP9 encoder configuration' };
  }

  const chunks: EncodedVideoChunk[] = [];
  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({
    codec: VP9_CODEC,
    width,
    height,
    bitrate: 2_000_000,
    framerate: fps,
  });

  const webmTarget = new ArrayBufferTarget();
  const webmMuxer = new WebmMuxer({
    target: webmTarget,
    video: { codec: 'V_VP9', width, height, frameRate: fps },
  });

  return {
    mimeType: 'video/webm',
    encodeFrame: (frame, keyFrame) => encoder.encode(frame, { keyFrame }),
    flush: async () => {
      await encoder.flush();
      encoder.close();
      for (const chunk of chunks) {
        webmMuxer.addVideoChunk(chunk);
      }
      webmMuxer.finalize();
    },
    close: () => encoder.close(),
    getBytes: () => new Uint8Array(webmTarget.buffer),
  };
}

/**
 * Export a timeline to encoded video bytes via WebCodecs.
 * Returns null bytes when encoding is unavailable in the current environment.
 */
export async function exportTimelineToVideo(
  timeline: VideoTimelineRef,
  options: VideoExportOptions,
  renderFrame: VideoFrameRenderer,
): Promise<VideoExportResult> {
  const support = checkVideoExportSupport();
  const frameCount = computeVideoFrameCount(
    timeline.duration,
    options.fps,
    options.reducedMotion,
  );

  if (!support.supported) {
    return {
      bytes: null,
      frameCount,
      supported: false,
      reason: support.reason,
    };
  }

  const session = await createEncoderSession(options);
  if ('error' in session) {
    return {
      bytes: null,
      frameCount,
      supported: false,
      reason: session.error,
    };
  }

  const durationUs = frameDurationUs(options.fps);
  const keyFrameInterval = Math.max(1, options.fps * 2);

  try {
    for (let i = 0; i < frameCount; i++) {
      if (options.signal?.aborted) {
        session.close();
        return {
          bytes: null,
          frameCount,
          supported: true,
          reason: 'Export cancelled',
        };
      }

      const timeMs = options.reducedMotion
        ? timeline.duration
        : frameCount <= 1
          ? 0
          : (i / (frameCount - 1)) * timeline.duration;

      const source = await renderFrame(timeMs, i);
      const timestampUs = i * durationUs;
      const frame = await sourceToVideoFrame(
        source,
        options.width,
        options.height,
        timestampUs,
        durationUs,
      );
      session.encodeFrame(frame, i % keyFrameInterval === 0);
      frame.close();
      options.onProgress?.(i + 1, frameCount);
    }

    await session.flush();
    return {
      bytes: session.getBytes(),
      frameCount,
      supported: true,
      mimeType: session.mimeType,
    };
  } catch (err) {
    session.close();
    const message = err instanceof Error ? err.message : String(err);
    return {
      bytes: null,
      frameCount,
      supported: false,
      reason: message,
    };
  }
}
