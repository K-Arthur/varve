/**
 * tsGif round-trip + parity tests.
 *
 * The fixture generator's GIF encoder and this decoder are independent
 * implementations; the committed fixtures provide the cross-check. Parity
 * with the Rust decoder (`varve-media`) is asserted where the fixture set
 * overlaps: timing, rects, disposal, transparency, interlacing, loop counts,
 * and exact pixels.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeGifFrames } from './tsGif';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function px(rgba: Uint8Array, w: number, x: number, y: number): [number, number, number, number] {
  const o = (y * w + x) * 4;
  return [rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!];
}

describe('tsGif: fixture decode', () => {
  it('gif-basic: three full frames, exact timing and pixels', () => {
    const result = decodeGifFrames(fixture('gif-basic.gif'));
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    expect(result.loopCount).toBe('infinite');
    expect(result.frames).toHaveLength(3);
    const expectColors: Array<[number, number, number, number]> = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ];
    result.frames.forEach((f, i) => {
      expect(f.durationMs).toBe([40, 100, 20][i]!);
      expect([f.x, f.y, f.width, f.height]).toEqual([0, 0, 64, 64]);
      expect(f.blend).toBe('source');
      expect(f.disposal).toBe('none');
      expect(f.rgba.length).toBe(64 * 64 * 4);
      expect(px(f.rgba, 64, 32, 32)).toEqual(expectColors[i]);
      expect(f.rgba.every((_, j) => (j % 4 < 3 ? true : f.rgba[j] === 255))).toBe(true);
    });
  });

  it('gif-delta: subrects and background disposal', () => {
    const { frames } = decodeGifFrames(fixture('gif-delta.gif'));
    expect(frames[0]!).toMatchObject({ x: 0, y: 0, width: 64, height: 64, disposal: 'background' });
    expect(frames[1]!).toMatchObject({ x: 8, y: 8, width: 16, height: 16, disposal: 'background' });
    expect(px(frames[1]!.rgba, 16, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(frames[2]!).toMatchObject({ x: 32, y: 32, width: 16, height: 16, disposal: 'none' });
    expect(px(frames[2]!.rgba, 16, 15, 15)).toEqual([0, 255, 0, 255]);
  });

  it('gif-dispose-previous: previous disposal preserved', () => {
    const { frames } = decodeGifFrames(fixture('gif-dispose-previous.gif'));
    expect(frames[1]!.disposal).toBe('previous');
    expect(frames[1]!).toMatchObject({ x: 8, y: 8, width: 16, height: 16 });
    expect(px(frames[1]!.rgba, 16, 8, 8)).toEqual([0, 0, 255, 255]);
  });

  it('gif-transparent: binary transparency via the transparent index', () => {
    const { frames } = decodeGifFrames(fixture('gif-transparent.gif'));
    expect(frames).toHaveLength(2);
    // left half opaque red, right half fully transparent
    expect(px(frames[0]!.rgba, 64, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(frames[0]!.rgba, 64, 31, 0)).toEqual([255, 0, 0, 255]);
    expect(px(frames[0]!.rgba, 64, 32, 0)).toEqual([0, 0, 0, 0]);
    expect(px(frames[0]!.rgba, 64, 63, 63)).toEqual([0, 0, 0, 0]);
    expect(px(frames[1]!.rgba, 16, 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('gif-interlaced: de-interlaces to the correct rows', () => {
    const { frames } = decodeGifFrames(fixture('gif-interlaced.gif'));
    expect(frames).toHaveLength(2);
    expect(px(frames[0]!.rgba, 32, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(frames[0]!.rgba, 32, 0, 31)).toEqual([255, 0, 0, 255]);
    expect(px(frames[1]!.rgba, 32, 31, 31)).toEqual([0, 0, 255, 255]);
    // every pixel of frame 1 is blue
    expect(
      frames[1]!.rgba.every((_, i) =>
        i % 4 < 3 ? frames[1]!.rgba[i] === (i % 4 === 0 ? 0 : i % 4 === 1 ? 0 : 255) : true,
      ),
    ).toBe(true);
  });

  it('gif-loop3: finite loop preserved', () => {
    const { loopCount, frames } = decodeGifFrames(fixture('gif-loop3.gif'));
    expect(loopCount).toBe(3);
    expect(frames).toHaveLength(2);
  });

  it('gif-zero-delay: zero delays preserved for the resolver', () => {
    const { frames } = decodeGifFrames(fixture('gif-zero-delay.gif'));
    expect(frames.map((f) => f.durationMs)).toEqual([40, 0, 100]);
  });

  it('gif-single: one frame, no loop extension (plays once)', () => {
    const { frames, loopCount } = decodeGifFrames(fixture('gif-single.gif'));
    expect(frames).toHaveLength(1);
    expect(loopCount).toBe(1);
  });

  it('malformed inputs fail safely', () => {
    expect(() =>
      decodeGifFrames(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2])),
    ).toThrow();
    const truncated = fixture('gif-basic.gif').subarray(0, 40);
    expect(() => decodeGifFrames(truncated)).toThrow();
  });
});
