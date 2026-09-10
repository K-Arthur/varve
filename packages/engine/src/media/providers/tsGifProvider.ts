/**
 * Pure-TS GIF decoder provider — the last-resort web fallback and the
 * node-env golden path. Output is identical to the Rust decoder's GIF
 * output (same fixture corpus validates both).
 */

import { decodeGifFrames } from '../tsGif';
import type { DecodedSourceFrame, MediaFormat } from '../types';
import type { DecodeRange, MediaDecoderProvider } from './types';

export const tsGifMediaProvider: MediaDecoderProvider = {
  id: 'ts-gif',
  supports(format) {
    return format === 'gif';
  },
  isAvailable(format) {
    return format === 'gif';
  },
  async decodeFrames(bytes, range: DecodeRange, _format: MediaFormat, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    const result = decodeGifFrames(bytes);
    if (signal?.aborted) throw new Error('cancelled');
    return result.frames
      .filter((f) => f.index >= range.start && f.index <= range.end)
      .map(
        (f): DecodedSourceFrame => ({
          index: f.index,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          durationMs: f.durationMs,
          blend: f.blend,
          disposal: f.disposal,
          preComposited: false,
          rgba: f.rgba,
        }),
      );
  },
};
