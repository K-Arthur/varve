/**
 * Chromium `ImageDecoder` provider (WebCodecs).
 *
 * Supported formats: GIF, WebP, AVIF (animated). APNG is NOT supported by
 * ImageDecoder — the chain falls through to wasm/ts-gif for APNG. Frames
 * arrive pre-composited full canvases (the browser composites internally);
 * per-frame timing comes from `VideoFrame.duration` (µs) and the compositor
 * pastes frames verbatim.
 */

import type { DecodedSourceFrame, MediaFormat } from '../types';
import type { DecodeRange, MediaDecoderProvider } from './types';

type ImageDecoderConstructor = new (options: {
  type: string;
  data: BufferSource;
}) => {
  tracks: {
    ready: Promise<unknown>;
    selectedTrack: { frameCount?: number } | null;
  };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
};

let decoderCtor: ImageDecoderConstructor | null | undefined;
let isTypeSupportedFn: ((mime: string) => Promise<boolean>) | undefined;

function imageDecoderGlobal(): typeof ImageDecoder | null {
  if (typeof ImageDecoder === 'function') return ImageDecoder as unknown as typeof ImageDecoder;
  return null;
}

function mimeFor(format: MediaFormat): string | null {
  switch (format) {
    case 'gif':
      return 'image/gif';
    case 'apng':
      return null; // ImageDecoder has no APNG support
    case 'webp':
      return 'image/webp';
  }
}

async function videoFrameToRgba(frame: VideoFrame): Promise<Uint8Array> {
  // Fast path: copyTo when the frame exposes RGBA directly.
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  const buffer = new ArrayBuffer(width * height * 4);
  const layout = await frame.copyTo(new Uint8Array(buffer), { format: 'RGBA' }).catch(() => null);
  if (layout) {
    const rowBytes = layout[0]?.stride ?? width * 4;
    if (rowBytes === width * 4) {
      frame.close();
      return new Uint8Array(buffer);
    }
    // padded rows: de-interleave
    const rgba = new Uint8Array(width * height * 4);
    const src = new Uint8Array(buffer);
    for (let y = 0; y < height; y++) {
      rgba.set(src.subarray(y * rowBytes, y * rowBytes + width * 4), y * width * 4);
    }
    frame.close();
    return rgba;
  }
  // Fallback: draw through an OffscreenCanvas.
  const bitmap = await createImageBitmap(frame);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ImageDecoder: canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  frame.close();
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
}

async function isDecoderAvailable(): Promise<boolean> {
  const globalCtor = imageDecoderGlobal();
  if (!globalCtor) return false;
  if (decoderCtor === null) return false;
  if (decoderCtor) return true;
  decoderCtor = globalCtor as unknown as ImageDecoderConstructor;
  isTypeSupportedFn = globalCtor.isTypeSupported.bind(globalCtor);
  return true;
}

export const imageDecoderProvider: MediaDecoderProvider = {
  id: 'image-decoder',
  supports(format) {
    return mimeFor(format) !== null;
  },
  async isAvailable(format, signal) {
    if (signal?.aborted) return false;
    const mime = mimeFor(format);
    if (!mime) return false;
    if (!(await isDecoderAvailable())) return false;
    try {
      return (await isTypeSupportedFn?.(mime)) ?? false;
    } catch {
      return false;
    }
  },
  async decodeFrames(bytes, range: DecodeRange, format: MediaFormat, signal) {
    const ctor = decoderCtor;
    const mime = mimeFor(format);
    if (!ctor || !mime) throw new Error('ImageDecoder unavailable');
    if (signal?.aborted) throw new Error('cancelled');
    const decoder = new ctor({ type: mime, data: bytes.buffer as ArrayBuffer });
    try {
      await decoder.tracks.ready;
      const frames: DecodedSourceFrame[] = [];
      for (let i = range.start; i <= range.end; i++) {
        if (signal?.aborted) throw new Error('cancelled');
        const { image } = await decoder.decode({ frameIndex: i });
        const rgba = await videoFrameToRgba(image);
        const width = image.displayWidth;
        const height = image.displayHeight;
        const durationMs = image.duration && image.duration > 0 ? image.duration / 1000 : 0;
        frames.push({
          index: i,
          x: 0,
          y: 0,
          width,
          height,
          durationMs,
          blend: 'source',
          disposal: 'none',
          preComposited: true,
          rgba,
        });
      }
      return frames;
    } finally {
      decoder.close();
    }
  },
};
