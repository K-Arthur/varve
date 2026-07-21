import { describe, expect, it } from 'vitest';
import {
  decodeSam2DecoderOutput,
  encodeSam2Prompts,
  SAM2_INPUT_SIZE,
  validateSam2Prompts,
} from '../models/sam2';

describe('sam2', () => {
  describe('encodeSam2Prompts', () => {
    it('encodes point prompts to 1024-space coordinates', () => {
      const result = encodeSam2Prompts({ points: [{ x: 0.5, y: 0.5, label: 1 }] });
      expect(result.pointCoords.data[0]).toBeCloseTo(512); // 0.5 * 1024
      expect(result.pointCoords.data[1]).toBeCloseTo(512);
      expect(result.pointLabels.data[0]).toBe(1);
      expect(result.pointCoords.dims).toEqual([1, 1, 2]);
      expect(result.pointLabels.dims).toEqual([1, 1]);
    });

    it('encodes multiple points', () => {
      const result = encodeSam2Prompts({
        points: [
          { x: 0.25, y: 0.25, label: 1 },
          { x: 0.75, y: 0.75, label: 0 },
        ],
      });
      expect(result.pointCoords.data.length).toBe(4);
      expect(result.pointLabels.data.length).toBe(2);
      expect(result.pointLabels.data[0]).toBe(1);
      expect(result.pointLabels.data[1]).toBe(0);
      expect(result.pointCoords.dims).toEqual([1, 2, 2]);
    });

    it('encodes box prompts as two extra points (labels 2/3) — no box_coords input exists', () => {
      const result = encodeSam2Prompts({ box: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 } });
      expect(result.pointLabels.data.length).toBe(2);
      expect(result.pointLabels.data[0]).toBe(2); // top-left corner
      expect(result.pointLabels.data[1]).toBe(3); // bottom-right corner
      expect(result.pointCoords.data[0]).toBeCloseTo(0.1 * SAM2_INPUT_SIZE);
      expect(result.pointCoords.data[1]).toBeCloseTo(0.1 * SAM2_INPUT_SIZE);
      expect(result.pointCoords.data[2]).toBeCloseTo(0.9 * SAM2_INPUT_SIZE);
      expect(result.pointCoords.data[3]).toBeCloseTo(0.9 * SAM2_INPUT_SIZE);
    });

    it('combines points and box into a single point batch', () => {
      const result = encodeSam2Prompts({
        points: [{ x: 0.5, y: 0.5, label: 1 }],
        box: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
      });
      expect(result.pointCoords.dims).toEqual([1, 3, 2]);
      expect(result.pointLabels.data[0]).toBe(1);
      expect(result.pointLabels.data[1]).toBe(2);
      expect(result.pointLabels.data[2]).toBe(3);
    });

    it('always includes required mask_input/has_mask_input, zero-filled with no previous mask', () => {
      const result = encodeSam2Prompts({ points: [{ x: 0.5, y: 0.5, label: 1 }] });
      expect(result.maskInput.dims).toEqual([1, 1, 256, 256]);
      expect(result.maskInput.data.length).toBe(256 * 256);
      expect(result.hasMaskInput.dims).toEqual([1]);
      expect(result.hasMaskInput.data[0]).toBe(0);
      for (const v of result.maskInput.data) {
        expect(v).toBe(0);
      }
    });

    it('sets has_mask_input=1 and resizes a previous mask into mask_input', () => {
      const prevMask = new Float32Array(4 * 4).fill(0.7);
      const result = encodeSam2Prompts({
        points: [{ x: 0.5, y: 0.5, label: 1 }],
        previousMask: { data: prevMask, width: 4, height: 4 },
      });
      expect(result.hasMaskInput.data[0]).toBe(1);
      expect(result.maskInput.data.length).toBe(256 * 256);
      expect(result.maskInput.data[0]).toBeCloseTo(0.7);
    });
  });

  describe('decodeSam2DecoderOutput', () => {
    it('picks the mask with the highest IoU as the primary result', () => {
      const maskH = 2;
      const maskW = 2;
      const numMasks = 3;
      const data = new Float32Array(numMasks * maskH * maskW);
      // mask 0: low activation, mask 1: high activation (best), mask 2: mid
      data.set([0.1, 0.1, 0.1, 0.1], 0);
      data.set([0.9, 0.9, 0.9, 0.9], 4);
      data.set([0.5, 0.5, 0.5, 0.5], 8);
      const iou = new Float32Array([0.2, 0.95, 0.6]);

      const decoded = decodeSam2DecoderOutput(
        data,
        [1, numMasks, maskH, maskW],
        iou,
        [1, numMasks],
        maskW,
        maskH,
      );

      expect(decoded.selectedIndex).toBe(1);
      expect(decoded.confidence).toBeCloseTo(0.95);
      expect(decoded.masks.length).toBe(3);
    });

    it('falls back to mean-activation confidence when no iou_predictions are given', () => {
      const raw = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const decoded = decodeSam2DecoderOutput(raw, [1, 1, 2, 2], null, null, 2, 2);
      expect(decoded.confidence).toBeCloseTo(0.5, 5);
    });

    it('upscales masks to the target width/height without transposing non-square images', () => {
      const raw = new Float32Array([1, 1, 1, 1]); // 2x2, fully positive
      const decoded = decodeSam2DecoderOutput(raw, [1, 1, 2, 2], null, null, 8, 4);
      const best = decoded.masks[decoded.selectedIndex]!;
      expect(best.width).toBe(8);
      expect(best.height).toBe(4);
      expect(best.mask.length).toBe(32);
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
