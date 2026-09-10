import { describe, expect, it } from 'vitest';
import { estimateExportBytes } from '../estimateSize';

describe('estimateExportBytes', () => {
  it('estimates PNG size based on pixel area', () => {
    // 1200×800 PNG: 1200*800*1.8 = 1,728,000
    expect(estimateExportBytes(1200, 800, 'png')).toBe(1_728_000);
  });

  it('estimates JPEG size with higher compression', () => {
    const result = estimateExportBytes(1200, 800, 'jpeg');
    expect(result).toBeGreaterThan(0);
    expect(result).toBe(1200 * 800 * 1.2);
  });

  it('estimates WebP size below JPEG', () => {
    expect(estimateExportBytes(1200, 800, 'webp')).toBeLessThan(
      estimateExportBytes(1200, 800, 'jpeg'),
    );
  });

  it('estimates SVG as a fixed base regardless of dimensions', () => {
    expect(estimateExportBytes(100, 100, 'svg')).toBe(estimateExportBytes(4000, 3000, 'svg'));
    expect(estimateExportBytes(100, 100, 'svg')).toBe(12 * 1024);
  });

  it('estimates PDF with a print-appropriate baseline', () => {
    expect(estimateExportBytes(2480, 3508, 'pdf')).toBe(40 * 1024);
  });

  it('scales linearly with pixel area for raster formats', () => {
    const small = estimateExportBytes(100, 100, 'png');
    const large = estimateExportBytes(200, 200, 'png');
    expect(large).toBe(small * 4);
  });

  it('returns a positive value for all supported raster formats', () => {
    for (const fmt of ['png', 'jpeg', 'webp', 'avif', 'gif', 'tiff', 'bmp'] as const) {
      expect(estimateExportBytes(1920, 1080, fmt)).toBeGreaterThan(0);
    }
  });

  it('handles zero/negative dimensions gracefully', () => {
    expect(estimateExportBytes(0, 0, 'png')).toBeGreaterThanOrEqual(0);
    expect(estimateExportBytes(-1, -1, 'png')).toBeGreaterThanOrEqual(0);
  });

  it('returns a baseline for code formats', () => {
    expect(estimateExportBytes(100, 100, 'react')).toBe(4 * 1024);
  });
});
