import { describe, expect, it } from 'vitest';
import {
  FONT_DETECT_INPUT_SIZE,
  heuristicFontMatch,
  preprocessFontDetect,
  validateFontDetectInput,
} from './fontDetect';

describe('preprocessFontDetect', () => {
  it('returns tensor of correct shape', () => {
    const imageData = new ImageData(100, 50);
    const tensor = preprocessFontDetect(imageData);
    expect(tensor.length).toBe(1 * 3 * FONT_DETECT_INPUT_SIZE * FONT_DETECT_INPUT_SIZE);
  });

  it('handles small images', () => {
    const imageData = new ImageData(30, 30);
    const tensor = preprocessFontDetect(imageData);
    expect(tensor.length).toBe(3 * FONT_DETECT_INPUT_SIZE * FONT_DETECT_INPUT_SIZE);
  });
});

describe('heuristicFontMatch', () => {
  function makeCharImage(width: number, height: number, inkDensity: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const isInk = i / (width * height) < inkDensity;
      data[i * 4] = isInk ? 0 : 255;
      data[i * 4 + 1] = isInk ? 0 : 255;
      data[i * 4 + 2] = isInk ? 0 : 255;
      data[i * 4 + 3] = 255;
    }
    return new ImageData(data, width, height);
  }

  it('ranks all known fonts', () => {
    const img = makeCharImage(100, 100, 0.42);
    const result = heuristicFontMatch(img, ['Inter', 'Arial', 'Times New Roman']);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('returns fonts sorted by confidence descending', () => {
    const img = makeCharImage(100, 100, 0.42);
    const result = heuristicFontMatch(img, ['Inter', 'Arial', 'Courier New']);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.confidence).toBeGreaterThanOrEqual(result[i]!.confidence);
    }
  });

  it('returns exact match for close density', () => {
    const img = makeCharImage(100, 100, 0.42);
    const result = heuristicFontMatch(img, ['Inter']);
    expect(result[0]!.matchType).toBe('exact');
    expect(result[0]!.confidence).toBeGreaterThan(0.8);
  });

  it('returns fallback for unknown fonts', () => {
    const img = makeCharImage(100, 100, 0.5);
    const result = heuristicFontMatch(img, ['UnknownFont']);
    expect(result[0]!.matchType).toBe('fallback');
  });

  it('handles empty known font list', () => {
    const img = makeCharImage(100, 100, 0.5);
    const result = heuristicFontMatch(img, []);
    expect(result.length).toBe(0);
  });
});

describe('validateFontDetectInput', () => {
  it('rejects small images', () => {
    const err = validateFontDetectInput({ imageData: new ImageData(10, 10) });
    expect(err).toContain('too small');
  });

  it('accepts valid inputs', () => {
    const err = validateFontDetectInput({
      imageData: new ImageData(100, 50),
    });
    expect(err).toBeNull();
  });

  it('rejects null image data', () => {
    const err = validateFontDetectInput({
      imageData: null as unknown as ImageData,
    });
    expect(err).not.toBeNull();
  });
});
