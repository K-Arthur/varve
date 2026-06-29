import { describe, expect, it } from 'vitest';
import { computeOutputDimensions } from './raster';
import { estimateFileSize } from './raster-size';

describe('computeOutputDimensions', () => {
  it('scales dimensions by factor', () => {
    const { width, height } = computeOutputDimensions({ x: 0, y: 0, w: 100, h: 50 }, 2);
    expect(width).toBe(200);
    expect(height).toBe(100);
  });

  it('rounds to nearest integer', () => {
    const { width, height } = computeOutputDimensions({ x: 0, y: 0, w: 10, h: 10 }, 1.5);
    expect(width).toBe(15);
    expect(height).toBe(15);
  });

  it('handles 1x scale', () => {
    const { width, height } = computeOutputDimensions({ x: 0, y: 0, w: 1920, h: 1080 }, 1);
    expect(width).toBe(1920);
    expect(height).toBe(1080);
  });

  it('handles 0.5x scale', () => {
    const { width, height } = computeOutputDimensions({ x: 0, y: 0, w: 800, h: 600 }, 0.5);
    expect(width).toBe(400);
    expect(height).toBe(300);
  });
});

describe('estimateFileSize', () => {
  // 100x100 = 10,000 pixels
  const w = 100, h = 100;

  it('estimates PNG size', () => {
    const size = estimateFileSize(w, h, 'png');
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(100000);
  });

  it('estimates JPEG size proportional to quality', () => {
    const low = estimateFileSize(w, h, 'jpeg', 10);
    const high = estimateFileSize(w, h, 'jpeg', 90);
    expect(high).toBeGreaterThan(low);
  });

  it('estimates JPEG at default quality', () => {
    const size = estimateFileSize(w, h, 'jpeg');
    expect(size).toBeGreaterThan(0);
  });

  it('WebP is estimated smaller than JPEG', () => {
    const jpeg = estimateFileSize(w, h, 'jpeg', 80);
    const webp = estimateFileSize(w, h, 'webp', 80);
    expect(webp).toBeLessThan(jpeg);
  });

  it('AVIF is estimated smaller than WebP', () => {
    const webp = estimateFileSize(w, h, 'webp', 80);
    const avif = estimateFileSize(w, h, 'avif', 80);
    expect(avif).toBeLessThan(webp);
  });

  it('clamps quality to valid range', () => {
    const below = estimateFileSize(w, h, 'jpeg', -10);
    const above = estimateFileSize(w, h, 'jpeg', 200);
    expect(below).toBeGreaterThan(0);
    expect(above).toBeGreaterThan(0);
  });
});
