import { describe, expect, it } from 'vitest';
import {
  decodeSam2Mask,
  encodeSam2Prompts,
  SAM2_INPUT_SIZE,
  validateSam2Prompts,
} from '../models/sam2';

describe('sam2', () => {
  describe('encodeSam2Prompts', () => {
    it('encodes point prompts to 1024-space coordinates', () => {
      const result = encodeSam2Prompts({ points: [{ x: 0.5, y: 0.5, label: 1 }] }, 640, 480);
      expect(result.pointCoords[0]).toBeCloseTo(512); // 0.5 * 1024
      expect(result.pointCoords[1]).toBeCloseTo(512);
      expect(result.pointLabels[0]).toBe(1);
    });

    it('encodes multiple points', () => {
      const result = encodeSam2Prompts(
        {
          points: [
            { x: 0.25, y: 0.25, label: 1 },
            { x: 0.75, y: 0.75, label: 0 },
          ],
        },
        640,
        480,
      );
      expect(result.pointCoords.length).toBe(4);
      expect(result.pointLabels.length).toBe(2);
      expect(result.pointLabels[0]).toBe(1);
      expect(result.pointLabels[1]).toBe(0);
    });

    it('encodes box prompts', () => {
      const result = encodeSam2Prompts({ box: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 } }, 640, 480);
      expect(result.hasBox).toBe(true);
      expect(result.boxCoords[0]).toBeCloseTo(0.1 * SAM2_INPUT_SIZE);
      expect(result.boxCoords[3]).toBeCloseTo(0.9 * SAM2_INPUT_SIZE);
    });

    it('handles empty prompts', () => {
      const result = encodeSam2Prompts({}, 640, 480);
      expect(result.pointCoords.length).toBe(0);
      expect(result.hasBox).toBe(false);
    });
  });

  describe('decodeSam2Mask', () => {
    it('decodes and thresholds raw output', () => {
      const raw = new Float32Array([0.3, 0.7, 0.2, 0.9]);
      const { mask } = decodeSam2Mask(raw, 2, 2, 4, 4, 0.5);
      expect(mask.length).toBe(16);
      // Nearest-neighbor upscale: 2x2 → 4x4 repeats each pixel 2x2
      // Source: [0.3, 0.7; 0.2, 0.9] → each becomes 2x2 block
      expect(mask[0]).toBe(0); // 0.3 < 0.5 (top-left block)
      expect(mask[1]).toBe(0); // 0.3 repeated
      expect(mask[2]).toBe(255); // 0.7 > 0.5 (top-right block)
      expect(mask[15]).toBe(255); // 0.9 > 0.5 (bottom-right)
    });

    it('computes confidence as mean activation', () => {
      const raw = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const { confidence } = decodeSam2Mask(raw, 2, 2, 2, 2, 0.0);
      expect(confidence).toBeCloseTo(0.5, 5);
    });

    it('handles same-size passthrough', () => {
      const raw = new Float32Array([0.8, 0.8, 0.8, 0.8]);
      const { mask } = decodeSam2Mask(raw, 2, 2, 2, 2, 0.5);
      expect(mask.length).toBe(4);
      for (const v of mask) {
        expect(v).toBe(255);
      }
    });
  });

  describe('validateSam2Prompts', () => {
    it('rejects empty prompts', () => {
      expect(validateSam2Prompts({})).toBeTruthy();
      expect(validateSam2Prompts({ points: [] })).toBeTruthy();
    });

    it('accepts valid point prompt', () => {
      expect(validateSam2Prompts({ points: [{ x: 0.5, y: 0.5, label: 1 }] })).toBeNull();
    });

    it('accepts valid box prompt', () => {
      expect(validateSam2Prompts({ box: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 } })).toBeNull();
    });

    it('rejects out-of-range point coordinates', () => {
      expect(validateSam2Prompts({ points: [{ x: 1.5, y: 0.5, label: 1 }] })).toBeTruthy();
    });

    it('rejects invalid point label', () => {
      expect(validateSam2Prompts({ points: [{ x: 0.5, y: 0.5, label: 2 as 0 | 1 }] })).toBeTruthy();
    });

    it('rejects inverted box', () => {
      expect(validateSam2Prompts({ box: { x1: 0.9, y1: 0.1, x2: 0.1, y2: 0.9 } })).toBeTruthy();
    });
  });
});
