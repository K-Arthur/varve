import { describe, expect, it } from 'vitest';
import { decodeLineArtOutput, LINE_ART_INPUT_SIZE } from './lineArt';

describe('lineArt', () => {
  it('exposes the verified fixed input size', () => {
    expect(LINE_ART_INPUT_SIZE).toBe(256);
  });

  describe('decodeLineArtOutput', () => {
    it('maps the [0,1] sigmoid output directly to grayscale without rescaling', () => {
      const data = new Float32Array([0, 0.5, 1, 0.25]);
      const result = decodeLineArtOutput(data, 2, 2, 2, 2);
      expect(result.data[0]).toBe(0);
      expect(result.data[4]).toBe(128); // 0.5 * 255 rounded
      expect(result.data[8]).toBe(255);
      expect(result.data[12]).toBe(64); // 0.25 * 255 rounded
      // alpha channel is always opaque
      expect(result.data[3]).toBe(255);
    });

    it('clamps out-of-range values', () => {
      const data = new Float32Array([-0.5, 1.5]);
      const result = decodeLineArtOutput(data, 2, 1, 2, 1);
      expect(result.data[0]).toBe(0);
      expect(result.data[4]).toBe(255);
    });

    it('upscales from the fixed 256x256 output to the target resolution without transposing', () => {
      const data = new Float32Array(4).fill(1); // 2x2, fully white
      const result = decodeLineArtOutput(data, 2, 2, 8, 4);
      expect(result.width).toBe(8);
      expect(result.height).toBe(4);
      for (let i = 0; i < result.data.length; i += 4) {
        expect(result.data[i]).toBe(255);
      }
    });

    it('passes through unchanged when output size already matches target', () => {
      const data = new Float32Array([0.2, 0.8, 0.4, 0.6]);
      const result = decodeLineArtOutput(data, 2, 2, 2, 2);
      expect(result.width).toBe(2);
      expect(result.height).toBe(2);
    });

    it('crops out letterbox padding before resizing to target (non-square source)', () => {
      // 4x4 model output where only the center 4x2 rows are "real content"
      // (rows 1-2), rows 0 and 3 are white letterbox padding — matching a
      // wide source image that was scaled to fit width and padded top/bottom.
      // biome-ignore format: readability of the grid layout
      const data = new Float32Array([
        1, 1, 1, 1, // padding row (white)
        0, 0, 1, 1, // real content: left half black, right half white
        0, 0, 1, 1, // real content: left half black, right half white
        1, 1, 1, 1, // padding row (white)
      ]);
      const withoutCrop = decodeLineArtOutput(data, 4, 4, 8, 4);
      const withCrop = decodeLineArtOutput(data, 4, 4, 8, 4, { offsetX: 0, offsetY: 1 });

      // Without cropping, the padding rows get stretched into the output,
      // diluting/shifting the real content vertically.
      // With cropping, every output row should show the same clean
      // left-black/right-white pattern (no padding-derived rows).
      for (let y = 0; y < 4; y++) {
        const rowStart = y * 8 * 4;
        expect(withCrop.data[rowStart]).toBe(0); // left = black
        expect(withCrop.data[rowStart + 7 * 4]).toBe(255); // right = white
      }
      // Sanity: the uncropped version is NOT uniformly black-left/white-right
      // for every row (it includes the stretched white padding), proving the
      // two code paths actually produce different output.
      const uncroppedRows = new Set<number>();
      for (let y = 0; y < 4; y++) {
        uncroppedRows.add(withoutCrop.data[y * 8 * 4]!);
      }
      expect(uncroppedRows.size).toBeGreaterThan(1);
    });

    it('leaves output unchanged when letterbox offsets are zero (square source)', () => {
      const data = new Float32Array([0.1, 0.9, 0.3, 0.7]);
      const withZeroOffset = decodeLineArtOutput(data, 2, 2, 2, 2, { offsetX: 0, offsetY: 0 });
      const withoutParam = decodeLineArtOutput(data, 2, 2, 2, 2);
      expect(Array.from(withZeroOffset.data)).toEqual(Array.from(withoutParam.data));
    });
  });
});
