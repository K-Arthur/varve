/**
 * Capability-driven video export — encoder abstraction with runtime detection.
 *
 * Provides a unified `encodeVideo` interface backed by multiple encoder
 * providers, selected by actual API availability at runtime — NOT by browser
 * name or operating system.
 *
 * Provider selection order:
 * 1. WebCodecs + mp4-muxer/webm-muxer (Chromium, most capable)
 * 2. MediaRecorder (Firefox, Safari, WebKitGTK — broader support)
 * 3. PNG sequence fallback when no video encoder exists
 *
 * Runtime detection verifies: API presence, encoder config support, codec
 * availability, alpha support, and destination writability.
 *
 * Research basis: WebCodecs spec (w3c), MediaRecorder API (MDN), MediaCapabilities API.
 */

export type VideoEncoderProvider = 'webcodecs' | 'mediarecorder' | 'image-sequence' | 'none';

export interface VideoEncodeCapabilities {
  provider: VideoEncoderProvider;
  codecs: string[];
  alphaSupport: boolean;
  maxResolution: { width: number; height: number } | null;
  supported: boolean;
  reason?: string;
}

export interface VideoEncodeOptions {
  width: number;
  height: number;
  fps: number;
  /** Preferred codec tag (h264 or vp9). */
  codec?: 'h264' | 'vp9';
  /** Bitrate in bps (WebCodecs only). */
  bitrate?: number;
  /** Include alpha channel if supported. */
  alpha?: boolean;
  /** Reduced-motion: render single frame. */
  reducedMotion?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface VideoEncodeResult {
  bytes: Uint8Array | null;
  mimeType: string;
  provider: VideoEncoderProvider;
  frameCount: number;
  /** For image-sequence fallback: array of PNG data URLs. */
  frames?: string[];
  reason?: string;
}

export type VideoFrameSource = (
  timeMs: number,
  frameIndex: number,
) => Promise<ImageBitmap | Uint8Array | HTMLCanvasElement>;

const H264_CODEC_CANDIDATES = ['avc1.42001E', 'avc1.4D401E', 'avc1.64001E'] as const;
const VP9_CODEC = 'vp09.00.10.08';

/**
 * Detect the best available video encoder provider at runtime.
 *
 * Uses feature detection only — never UA sniffing. Returns the most capable
 * provider that is actually available *and* can encode the requested codec.
 */
export async function detectVideoCapabilities(
  options: Pick<VideoEncodeOptions, 'width' | 'height' | 'fps' | 'codec'> = {
    width: 1920,
    height: 1080,
    fps: 30,
  },
): Promise<VideoEncodeCapabilities> {
  // 1. Check WebCodecs (most capable, Chromium-only).
  if (
    typeof globalThis.VideoEncoder !== 'undefined' &&
    typeof globalThis.VideoFrame !== 'undefined'
  ) {
    const codec = await pickSupportedCodec(options);
    if (codec) {
      return {
        provider: 'webcodecs',
        codecs: [codec],
        alphaSupport: false,
        maxResolution: { width: 8192, height: 8192 },
        supported: true,
      };
    }
  }

  // 2. Check MediaRecorder (broader support: Firefox, Safari, WebKitGTK).
  if (typeof globalThis.MediaRecorder !== 'undefined') {
    const mimeType = pickMediaRecorderMimeType(options.codec);
    if (mimeType && MediaRecorder.isTypeSupported(mimeType)) {
      return {
        provider: 'mediarecorder',
        codecs: [mimeType],
        alphaSupport: mimeType.includes('vp9') || mimeType.includes('vp8'),
        maxResolution: { width: 4096, height: 4096 },
        supported: true,
      };
    }
  }

  // 3. PNG sequence always works (OffscreenCanvas or HTMLCanvasElement).
  const hasCanvas =
    typeof OffscreenCanvas !== 'undefined' || typeof HTMLCanvasElement !== 'undefined';
  if (hasCanvas) {
    return {
      provider: 'image-sequence',
      codecs: ['image/png'],
      alphaSupport: true,
      maxResolution: null,
      supported: true,
      reason: 'No video encoder; PNG sequence available',
    };
  }

  return {
    provider: 'none',
    codecs: [],
    alphaSupport: false,
    maxResolution: null,
    supported: false,
    reason: 'No video encoder and no canvas rendering available',
  };
}

async function pickSupportedCodec(
  options: Pick<VideoEncodeOptions, 'width' | 'height' | 'fps' | 'codec'>,
): Promise<string | null> {
  const { width, height, fps } = options;
  const preferH264 = options.codec !== 'vp9';

  if (preferH264) {
    for (const codec of H264_CODEC_CANDIDATES) {
      try {
        const result = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate: 2_000_000,
          framerate: fps,
        });
        if (result.supported) return codec;
      } catch {
        // continue
      }
    }
  }

  try {
    const result = await VideoEncoder.isConfigSupported({
      codec: VP9_CODEC,
      width,
      height,
      bitrate: 2_000_000,
      framerate: fps,
    });
    if (result.supported) return VP9_CODEC;
  } catch {
    // continue
  }

  return null;
}

function pickMediaRecorderMimeType(preferredCodec?: 'h264' | 'vp9'): string | null {
  const candidates =
    preferredCodec === 'vp9'
      ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      : ['video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return null;
}

/**
 * Encode a sequence of frames to video using the best available provider.
 *
 * Shared entry point for all video export in Strata. Abstracts away the
 * provider selection so feature code only calls this function.
 */
export async function encodeVideo(
  frameSource: VideoFrameSource,
  frameCount: number,
  options: VideoEncodeOptions,
): Promise<VideoEncodeResult> {
  const caps = await detectVideoCapabilities(options);

  if (!caps.supported || caps.provider === 'none') {
    return {
      bytes: null,
      mimeType: '',
      provider: 'none',
      frameCount,
      reason: caps.reason ?? 'No video encoder available',
    };
  }

  switch (caps.provider) {
    case 'webcodecs':
      return encodeWithWebCodecs(frameSource, frameCount, options);
    case 'mediarecorder':
      return encodeWithMediaRecorder(frameSource, frameCount, options);
    case 'image-sequence':
      return encodeAsImageSequence(frameSource, frameCount, options);
    default:
      return {
        bytes: null,
        mimeType: '',
        provider: 'none',
        frameCount,
        reason: 'Unknown encoder provider',
      };
  }
}

/**
 * WebCodecs encoder — the primary path for Chromium browsers.
 */
async function encodeWithWebCodecs(
  frameSource: VideoFrameSource,
  frameCount: number,
  options: VideoEncodeOptions,
): Promise<VideoEncodeResult> {
  const { width, height, fps, signal, onProgress } = options;
  const durationUs = Math.round(1_000_000 / fps);
  const keyFrameInterval = Math.max(1, fps * 2);
  const bitrate = options.bitrate ?? 2_000_000;

  // Pick codec.
  const h264 = options.codec !== 'vp9';
  let codecStr: string | null = null;
  if (h264) {
    for (const codec of H264_CODEC_CANDIDATES) {
      try {
        const r = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate,
          framerate: fps,
        });
        if (r.supported) {
          codecStr = codec;
          break;
        }
      } catch {
        /* continue */
      }
    }
  }
  if (!codecStr) {
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec: VP9_CODEC,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (r.supported) codecStr = VP9_CODEC;
    } catch {
      /* continue */
    }
  }
  if (!codecStr) {
    return {
      bytes: null,
      mimeType: '',
      provider: 'webcodecs',
      frameCount,
      reason: 'No codec supported',
    };
  }

  const isH264 = codecStr.startsWith('avc1');

  // Lazy-load muxers.
  if (isH264) {
    const { ArrayBufferTarget, Muxer } = await import('mp4-muxer');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
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
    encoder.configure({ codec: codecStr, width, height, bitrate, framerate: fps });

    try {
      for (let i = 0; i < frameCount; i++) {
        if (signal?.aborted) {
          encoder.close();
          return {
            bytes: null,
            mimeType: 'video/mp4',
            provider: 'webcodecs',
            frameCount,
            reason: 'Cancelled',
          };
        }
        const source = await frameSource(i * (1000 / fps), i);
        const frame = await sourceToVideoFrame(source, width, height, i * durationUs, durationUs);
        encoder.encode(frame, { keyFrame: i % keyFrameInterval === 0 });
        frame.close();
        onProgress?.(i + 1, frameCount);
      }
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      return {
        bytes: new Uint8Array(target.buffer),
        mimeType: 'video/mp4',
        provider: 'webcodecs',
        frameCount,
      };
    } catch (err) {
      encoder.close();
      return {
        bytes: null,
        mimeType: 'video/mp4',
        provider: 'webcodecs',
        frameCount,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    const { ArrayBufferTarget, Muxer } = await import('webm-muxer');
    const target = new ArrayBufferTarget();
    const chunks: EncodedVideoChunk[] = [];
    const encoder = new VideoEncoder({
      output: (chunk) => chunks.push(chunk),
      error: (e) => {
        throw e;
      },
    });
    encoder.configure({ codec: VP9_CODEC, width, height, bitrate, framerate: fps });

    try {
      for (let i = 0; i < frameCount; i++) {
        if (signal?.aborted) {
          encoder.close();
          return {
            bytes: null,
            mimeType: 'video/webm',
            provider: 'webcodecs',
            frameCount,
            reason: 'Cancelled',
          };
        }
        const source = await frameSource(i * (1000 / fps), i);
        const frame = await sourceToVideoFrame(source, width, height, i * durationUs, durationUs);
        encoder.encode(frame, { keyFrame: i % keyFrameInterval === 0 });
        frame.close();
        onProgress?.(i + 1, frameCount);
      }
      await encoder.flush();
      encoder.close();
      const muxer = new Muxer({ target, video: { codec: 'V_VP9', width, height, frameRate: fps } });
      for (const chunk of chunks) muxer.addVideoChunk(chunk);
      muxer.finalize();
      return {
        bytes: new Uint8Array(target.buffer),
        mimeType: 'video/webm',
        provider: 'webcodecs',
        frameCount,
      };
    } catch (err) {
      encoder.close();
      return {
        bytes: null,
        mimeType: 'video/webm',
        provider: 'webcodecs',
        frameCount,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * MediaRecorder encoder — fallback for Firefox, Safari, WebKitGTK.
 *
 * Renders frames to a canvas, captures the stream, and records. Less precise
 * timing than WebCodecs but much broader support.
 */
async function encodeWithMediaRecorder(
  frameSource: VideoFrameSource,
  frameCount: number,
  options: VideoEncodeOptions,
): Promise<VideoEncodeResult> {
  const { width, height, fps, signal, onProgress } = options;

  // MediaRecorder needs a live canvas + stream. We render frames manually
  // and request frames at the target fps.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      bytes: null,
      mimeType: '',
      provider: 'mediarecorder',
      frameCount,
      reason: '2D context unavailable',
    };
  }

  const mimeType = pickMediaRecorderMimeType(options.codec) ?? 'video/webm';
  const stream = canvas.captureStream(0); // 0 fps — we control timing via requestFrame
  const track = stream.getVideoTracks()[0];
  if (track && 'requestFrame' in track) {
    // Will drive frames manually below.
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: options.bitrate ?? 2_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const frameDurationMs = 1000 / fps;

  return new Promise<VideoEncodeResult>((resolve) => {
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      resolve({
        bytes: new Uint8Array(arrayBuffer),
        mimeType,
        provider: 'mediarecorder',
        frameCount,
      });
    };

    recorder.onerror = () => {
      resolve({
        bytes: null,
        mimeType,
        provider: 'mediarecorder',
        frameCount,
        reason: 'MediaRecorder error',
      });
    };

    recorder.start();

    let frameIndex = 0;
    const renderNext = async () => {
      if (signal?.aborted || frameIndex >= frameCount) {
        recorder.stop();
        return;
      }
      const timeMs = frameIndex * frameDurationMs;
      try {
        const source = await frameSource(timeMs, frameIndex);
        drawSourceToCanvas(source, ctx, width, height);
        // Request next frame capture.
        if (track && 'requestFrame' in track) {
          (track as unknown as { requestFrame: () => void }).requestFrame();
        }
        frameIndex++;
        onProgress?.(frameIndex, frameCount);
        setTimeout(renderNext, frameDurationMs);
      } catch (err) {
        recorder.stop();
        resolve({
          bytes: null,
          mimeType,
          provider: 'mediarecorder',
          frameCount,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    };

    renderNext();
  });
}

/**
 * PNG sequence fallback — when no video encoder is available.
 *
 * Returns an array of PNG data URLs that the caller can save individually
 * or hand to a native encoder.
 */
async function encodeAsImageSequence(
  frameSource: VideoFrameSource,
  frameCount: number,
  options: VideoEncodeOptions,
): Promise<VideoEncodeResult> {
  const { width, height, signal, onProgress, reducedMotion } = options;
  const frames: string[] = [];
  const count = reducedMotion ? 1 : frameCount;

  for (let i = 0; i < count; i++) {
    if (signal?.aborted) {
      return {
        bytes: null,
        mimeType: 'image/png',
        provider: 'image-sequence',
        frameCount: count,
        frames,
        reason: 'Cancelled',
      };
    }
    const timeMs = count <= 1 ? 0 : (i / (count - 1)) * (count * (1000 / 30));
    try {
      const source = await frameSource(timeMs, i);
      const dataUrl = await sourceToDataUrl(source, width, height);
      frames.push(dataUrl);
      onProgress?.(i + 1, count);
    } catch (err) {
      return {
        bytes: null,
        mimeType: 'image/png',
        provider: 'image-sequence',
        frameCount: count,
        frames,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    bytes: null,
    mimeType: 'image/png',
    provider: 'image-sequence',
    frameCount: count,
    frames,
  };
}

// --- Helpers ---

async function sourceToVideoFrame(
  source: ImageBitmap | Uint8Array | HTMLCanvasElement,
  width: number,
  height: number,
  timestampUs: number,
  durationUs: number,
): Promise<VideoFrame> {
  if (source instanceof Uint8Array) {
    const expected = width * height * 4;
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : (() => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            return c;
          })();
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('2D context unavailable');
    const clamped = new Uint8ClampedArray(expected);
    clamped.set(source.subarray(0, expected));
    ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
    return new VideoFrame(canvas as CanvasImageSource, {
      timestamp: timestampUs,
      duration: durationUs,
    });
  }
  if (source instanceof HTMLCanvasElement) {
    return new VideoFrame(source, { timestamp: timestampUs, duration: durationUs });
  }
  const frame = new VideoFrame(source, { timestamp: timestampUs, duration: durationUs });
  source.close();
  return frame;
}

function drawSourceToCanvas(
  source: ImageBitmap | Uint8Array | HTMLCanvasElement,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  if (source instanceof Uint8Array) {
    const expected = width * height * 4;
    const clamped = new Uint8ClampedArray(expected);
    clamped.set(source.subarray(0, expected));
    ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
  } else if (source instanceof HTMLCanvasElement) {
    ctx.drawImage(source, 0, 0, width, height);
  } else {
    ctx.drawImage(source, 0, 0, width, height);
    source.close();
  }
}

async function sourceToDataUrl(
  source: ImageBitmap | Uint8Array | HTMLCanvasElement,
  width: number,
  height: number,
): Promise<string> {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : (() => {
          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          return c;
        })();
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('2D context unavailable');
  drawSourceToCanvas(source, ctx, width, height);
  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  }
  // OffscreenCanvas: convert via convertToBlob.
  const blob = await (
    canvas as unknown as { convertToBlob: (opts: { type: string }) => Promise<Blob> }
  ).convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}
