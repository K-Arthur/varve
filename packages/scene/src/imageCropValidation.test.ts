/**
 * Tests for image crop + transform validation helpers.
 *
 * Covers: clampImageCropRect, isFullImageCrop, normalizeImageCropRect,
 * normalizeImageRotation.
 */
import { describe, expect, it } from 'vitest';
import {
  clampImageCropRect,
  isFullImageCrop,
  normalizeImageCropRect,
  normalizeImageRotation,
} from './types';

describe('clampImageCropRect', () => {
  it('passes through a valid crop unchanged', () => {
    expect(clampImageCropRect({ x: 10, y: 20, w: 100, h: 80 }, 200, 200)).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 80,
    });
  });

  it('clamps negative origin to 0', () => {
    expect(clampImageCropRect({ x: -5, y: -10, w: 100, h: 80 }, 200, 200)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
  });

  it('clamps width to not exceed source bounds', () => {
    expect(clampImageCropRect({ x: 150, y: 0, w: 100, h: 80 }, 200, 200)).toEqual({
      x: 150,
      y: 0,
      w: 50,
      h: 80,
    });
  });

  it('ensures minimum 1x1 dimensions', () => {
    expect(clampImageCropRect({ x: 0, y: 0, w: 0, h: 0 }, 200, 200)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it('handles crop at the far edge', () => {
    expect(clampImageCropRect({ x: 199, y: 199, w: 50, h: 50 }, 200, 200)).toEqual({
      x: 199,
      y: 199,
      w: 1,
      h: 1,
    });
  });

  it('treats zero/negative source as 1x1', () => {
    expect(clampImageCropRect({ x: 0, y: 0, w: 100, h: 100 }, 0, 0)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});

describe('isFullImageCrop', () => {
  it('returns true for undefined crop', () => {
    expect(isFullImageCrop(undefined, 200, 100)).toBe(true);
  });

  it('returns true when crop covers entire source', () => {
    expect(isFullImageCrop({ x: 0, y: 0, w: 200, h: 100 }, 200, 100)).toBe(true);
  });

  it('returns true when crop exceeds source bounds', () => {
    expect(isFullImageCrop({ x: -10, y: -10, w: 300, h: 200 }, 200, 100)).toBe(true);
  });

  it('returns false for a partial crop', () => {
    expect(isFullImageCrop({ x: 50, y: 25, w: 100, h: 50 }, 200, 100)).toBe(false);
  });

  it('returns false when crop is slightly smaller than source', () => {
    expect(isFullImageCrop({ x: 0, y: 0, w: 199, h: 100 }, 200, 100)).toBe(false);
  });
});

describe('normalizeImageCropRect', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeImageCropRect(undefined, 200, 100)).toBeUndefined();
  });

  it('returns undefined for NaN/Infinity fields', () => {
    expect(normalizeImageCropRect({ x: NaN, y: 0, w: 100, h: 50 }, 200, 100)).toBeUndefined();
    expect(normalizeImageCropRect({ x: 0, y: 0, w: Infinity, h: 50 }, 200, 100)).toBeUndefined();
  });

  it('returns undefined when crop covers full source', () => {
    expect(normalizeImageCropRect({ x: 0, y: 0, w: 200, h: 100 }, 200, 100)).toBeUndefined();
  });

  it('clamps origin and returns a partial crop', () => {
    // Negative origin clamped to 0, but w/h still partial
    expect(normalizeImageCropRect({ x: -5, y: -5, w: 100, h: 80 }, 200, 100)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
  });

  it('returns undefined when clamped crop covers full source', () => {
    // After clamping, the crop covers the entire source → undefined
    expect(normalizeImageCropRect({ x: -5, y: -5, w: 300, h: 200 }, 200, 100)).toBeUndefined();
  });

  it('passes through a valid partial crop', () => {
    expect(normalizeImageCropRect({ x: 10, y: 10, w: 50, h: 40 }, 200, 100)).toEqual({
      x: 10,
      y: 10,
      w: 50,
      h: 40,
    });
  });
});

describe('normalizeImageRotation', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeImageRotation(undefined)).toBeUndefined();
  });

  it('returns undefined for non-finite values', () => {
    expect(normalizeImageRotation(NaN)).toBeUndefined();
    expect(normalizeImageRotation(Infinity)).toBeUndefined();
  });

  it('normalizes negative rotation to [0, 360)', () => {
    expect(normalizeImageRotation(-90)).toBe(270);
    expect(normalizeImageRotation(-360)).toBe(0);
  });

  it('wraps rotation > 360', () => {
    expect(normalizeImageRotation(450)).toBe(90);
    expect(normalizeImageRotation(720)).toBe(0);
  });

  it('snaps near-zero to 0', () => {
    expect(normalizeImageRotation(0)).toBe(0);
    expect(normalizeImageRotation(1e-8)).toBe(0);
  });

  it('passes through valid rotation', () => {
    expect(normalizeImageRotation(90)).toBe(90);
    expect(normalizeImageRotation(180)).toBe(180);
    expect(normalizeImageRotation(270)).toBe(270);
    expect(normalizeImageRotation(45.5)).toBe(45.5);
  });
});
