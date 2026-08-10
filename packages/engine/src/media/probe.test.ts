/**
 * Probe tests against the committed fixture corpus
 * (`packages/engine/src/media/__fixtures__`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { probeAnimatedMedia } from './probe';
import { MediaProbeError } from './types';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

describe('probe: GIF', () => {
  it('gif-basic: full-frame timing, infinite loop', () => {
    const result = probeAnimatedMedia(fixture('gif-basic.gif'));
    expect(result.kind).toBe('gif');
    expect(result.mime).toBe('image/gif');
    const m = result.metadata!;
    expect(m.frameCount).toBe(3);
    expect(m.width).toBe(64);
    expect(m.height).toBe(64);
    expect(m.loopCount).toBe('infinite');
    expect(m.durationMs).toBe(160);
    expect(m.frames.map((f) => f.durationMs)).toEqual([40, 100, 20]);
    expect(m.frames.map((f) => [f.x, f.y, f.width, f.height])).toEqual([
      [0, 0, 64, 64],
      [0, 0, 64, 64],
      [0, 0, 64, 64],
    ]);
    expect(m.frames.map((f) => f.blend)).toEqual(['source', 'source', 'source']);
  });

  it('gif-delta: subrect frames with background disposal', () => {
    const m = probeAnimatedMedia(fixture('gif-delta.gif')).metadata!;
    expect(m.frames[0]!).toMatchObject({
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      disposal: 'background',
    });
    expect(m.frames[1]!).toMatchObject({
      x: 8,
      y: 8,
      width: 16,
      height: 16,
      disposal: 'background',
    });
    expect(m.frames[2]!).toMatchObject({ x: 32, y: 32, width: 16, height: 16, disposal: 'none' });
  });

  it('gif-dispose-previous: previous disposal preserved', () => {
    const m = probeAnimatedMedia(fixture('gif-dispose-previous.gif')).metadata!;
    expect(m.frames[1]!.disposal).toBe('previous');
  });

  it('gif-transparent: durations and rects', () => {
    const m = probeAnimatedMedia(fixture('gif-transparent.gif')).metadata!;
    expect(m.frames).toHaveLength(2);
    expect(m.frames[0]!).toMatchObject({ x: 0, y: 0, width: 64, height: 64 });
    expect(m.frames[1]!).toMatchObject({ x: 8, y: 8, width: 16, height: 16 });
  });

  it('gif-interlaced: probed normally (interlace is a decode concern)', () => {
    const m = probeAnimatedMedia(fixture('gif-interlaced.gif')).metadata!;
    expect(m.frameCount).toBe(2);
  });

  it('gif-loop3: finite loop count', () => {
    const m = probeAnimatedMedia(fixture('gif-loop3.gif')).metadata!;
    expect(m.loopCount).toBe(3);
  });

  it('gif-zero-delay: explicit zero delays preserved', () => {
    const m = probeAnimatedMedia(fixture('gif-zero-delay.gif')).metadata!;
    expect(m.frames.map((f) => f.durationMs)).toEqual([40, 0, 100]);
  });

  it('gif-single: one frame is static, not animated', () => {
    const result = probeAnimatedMedia(fixture('gif-single.gif'));
    expect(result.kind).toBe('static');
    expect(result.metadata).toBeUndefined();
  });

  it('rejects truncated GIF', () => {
    const bytes = fixture('gif-basic.gif');
    expect(() => probeAnimatedMedia(bytes.subarray(0, 30))).toThrow(MediaProbeError);
  });

  it('rejects garbage GIF header', () => {
    expect(() =>
      probeAnimatedMedia(new Uint8Array([0x47, 0x49, 0x46, 0x39, 0x39, 0x61, 1, 2])),
    ).toThrow(MediaProbeError);
  });
});

describe('probe: APNG', () => {
  it('apng-basic: num/den timing, infinite loop', () => {
    const result = probeAnimatedMedia(fixture('apng-basic.png'));
    expect(result.kind).toBe('apng');
    expect(result.mime).toBe('image/png');
    const m = result.metadata!;
    expect(m.frameCount).toBe(3);
    expect(m.width).toBe(64);
    expect(m.height).toBe(64);
    expect(m.loopCount).toBe('infinite');
    expect(m.frames.map((f) => f.durationMs)).toEqual([40, 100, 20]);
    expect(m.frames.map((f) => f.blend)).toEqual(['source', 'source', 'source']);
  });

  it('apng-delta: subrects, dispose background, blend source', () => {
    const m = probeAnimatedMedia(fixture('apng-delta.png')).metadata!;
    expect(m.frames[1]!).toMatchObject({
      x: 8,
      y: 8,
      width: 16,
      height: 16,
      disposal: 'background',
      blend: 'source',
    });
    expect(m.frames[2]!).toMatchObject({ x: 32, y: 32, width: 16, height: 16, disposal: 'none' });
  });

  it('apng-blend-over: blend over', () => {
    const m = probeAnimatedMedia(fixture('apng-blend-over.png')).metadata!;
    expect(m.frames[1]!).toMatchObject({ x: 24, y: 24, width: 16, height: 16, blend: 'over' });
  });

  it('apng-single: single-frame acTL normalizes to static', () => {
    const result = probeAnimatedMedia(fixture('apng-single.png'));
    expect(result.kind).toBe('static');
    expect(result.mime).toBe('image/png');
  });

  it('rejects truncated APNG chunks', () => {
    const bytes = fixture('apng-basic.png');
    // cut inside the acTL chunk body (chunk header readable, data overruns)
    expect(() => probeAnimatedMedia(bytes.subarray(0, 44))).toThrow(MediaProbeError);
    // a clean EOF before any acTL is a valid static PNG, not an error
    expect(probeAnimatedMedia(bytes.subarray(0, 33)).kind).toBe('static');
  });
});

describe('probe: WebP', () => {
  it('webp-animated: frame rects, durations, infinite loop', () => {
    const result = probeAnimatedMedia(fixture('webp-animated.webp'));
    expect(result.kind).toBe('webp');
    expect(result.mime).toBe('image/webp');
    const m = result.metadata!;
    expect(m.frameCount).toBe(3);
    expect(m.width).toBe(64);
    expect(m.height).toBe(64);
    expect(m.loopCount).toBe('infinite');
    // durations from the ANMF chunks (ffmpeg concat re-times frames)
    expect(m.frames.map((f) => f.durationMs)).toEqual([40, 120, 40]);
    expect(m.frames.every((f) => f.preComposited)).toBe(true);
  });

  it('webp-static: single frame is static', () => {
    const result = probeAnimatedMedia(fixture('webp-static.webp'));
    expect(result.kind).toBe('static');
    expect(result.mime).toBe('image/webp');
  });

  it('rejects truncated WebP chunks', () => {
    const bytes = fixture('webp-animated.webp');
    expect(() => probeAnimatedMedia(bytes.subarray(0, bytes.length - 4))).toThrow(MediaProbeError);
  });
});

describe('probe: unknown content', () => {
  it('unrecognized bytes are null, not errors', () => {
    expect(probeAnimatedMedia(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).kind).toBeNull();
    expect(probeAnimatedMedia(new Uint8Array()).kind).toBeNull();
  });

  it('a static JPEG is unrecognized by the media probe (handled by import)', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    expect(probeAnimatedMedia(jpeg).kind).toBeNull();
  });
});
