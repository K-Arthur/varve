// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  computeSaliencyMap,
  selectForegroundBorder,
  selectForegroundCenter,
} from './foregroundSelect';

function makeSolidImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 255;
  }
  return new ImageData(data, width, height);
}

function makeTwoToneImage(
  width: number,
  height: number,
  splitX: number,
  fgR: number,
  fgG: number,
  fgB: number,
  bgR: number,
  bgG: number,
  bgB: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isLeft = x < splitX;
      data[idx] = isLeft ? fgR : bgR;
      data[idx + 1] = isLeft ? fgG : bgG;
      data[idx + 2] = isLeft ? fgB : bgB;
      data[idx + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe('selectForegroundCenter', () => {
  it('selects foreground region based on center color', () => {
    const img = makeTwoToneImage(100, 100, 60, 255, 255, 255, 0, 0, 0);
    const result = selectForegroundCenter(img);

    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
    expect(result.mask.length).toBe(10000);

    // Center area (x=50, y=50) should be foreground (white region)
    const centerIdx = 50 * 100 + 50;
    expect(result.mask[centerIdx]).toBe(255);

    // Far left area should be foreground (white)
    expect(result.mask[5 * 100 + 5]).toBe(255);

    // Far right should be background (black)
    expect(result.mask[5 * 100 + 95]).toBe(0);
  });

  it('handles solid image (all one color)', () => {
    const img = makeSolidImage(20, 20, 128, 128, 128);
    const result = selectForegroundCenter(img);

    // Most pixels should be foreground
    const fgCount = result.mask.filter((v) => v === 255).length;
    expect(fgCount).toBeGreaterThan(300);
  });

  it('has confidence in expected range', () => {
    const img = makeTwoToneImage(50, 50, 35, 255, 255, 255, 0, 0, 0);
    const result = selectForegroundCenter(img);

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('selectForegroundBorder', () => {
  it('selects center 60% of image', () => {
    const img = makeSolidImage(100, 100, 255, 255, 255);
    const result = selectForegroundBorder(img);

    expect(result.width).toBe(100);
    expect(result.height).toBe(100);

    // Center should be foreground
    expect(result.mask[50 * 100 + 50]).toBe(255);

    // Corners should be background
    expect(result.mask[0]).toBe(0);
    expect(result.mask[99 * 100 + 99]).toBe(0);
  });
});

describe('computeSaliencyMap', () => {
  it('returns saliency map with center bias', () => {
    const img = makeTwoToneImage(50, 50, 25, 0, 0, 255, 128, 128, 128);
    const saliency = computeSaliencyMap(img);

    expect(saliency.length).toBe(2500);
    // Center should have higher saliency than corners
    const centerVal = saliency[25 * 50 + 25]!;
    const cornerVal = saliency[0]!;
    expect(centerVal).toBeGreaterThanOrEqual(cornerVal);
  });
});
