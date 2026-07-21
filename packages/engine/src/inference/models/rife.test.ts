import { describe, expect, it } from 'vitest';
import { decodeRifeOutput, RIFE_INPUT_SIZE, RIFE_TENSOR_SPEC } from './rife';

describe('rife', () => {
  it('exposes the input size used for the standard 6-channel frame0+frame1 convention', () => {
    expect(RIFE_INPUT_SIZE).toBe(256);
  });

  it('uses no normalization — inputs are [0,1] RGB per the standard RIFE convention', () => {
    expect(RIFE_TENSOR_SPEC.mean).toEqual([0, 0, 0]);
    expect(RIFE_TENSOR_SPEC.std).toEqual([1, 1, 1]);
  });

  describe('decodeRifeOutput', () => {
    it('converts planar [0,1] RGB output to interleaved 0-255 RGBA', () => {
      // 1x1 output: R=0, G=0.5, B=1
      const data = new Float32Array([0, 0.5, 1]);
      const result = decodeRifeOutput(data, 1, 1, 1, 1);
      expect(result.data[0]).toBe(0);
      expect(result.data[1]).toBe(128);
      expect(result.data[2]).toBe(255);
      expect(result.data[3]).toBe(255);
    });

    it('clamps out-of-range values', () => {
      const data = new Float32Array([-0.5, 1.5, 0.5]);
      const result = decodeRifeOutput(data, 1, 1, 1, 1);
      expect(result.data[0]).toBe(0);
      expect(result.data[1]).toBe(255);
      expect(result.data[2]).toBe(128);
    });

    it('upscales from the fixed square output to the target resolution without transposing', () => {
      const data = new Float32Array(4 * 3).fill(1); // 2x2, fully white
      const result = decodeRifeOutput(data, 2, 2, 8, 4);
      expect(result.width).toBe(8);
      expect(result.height).toBe(4);
      for (let i = 0; i < result.data.length; i += 4) {
        expect(result.data[i]).toBe(255);
        expect(result.data[i + 1]).toBe(255);
        expect(result.data[i + 2]).toBe(255);
      }
    });
  });
});
