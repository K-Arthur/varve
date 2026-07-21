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
  });
});
