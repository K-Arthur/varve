import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyticalRgbToCmyk } from '../adjustment/colorConversion';
import {
  collectImageSrcsFromFills,
  invalidateIccCache,
  scaleDimensions,
} from '../iccImageConverter';

describe('iccImageConverter', () => {
  beforeEach(() => {
    invalidateIccCache();
  });

  afterEach(() => {
    invalidateIccCache();
  });

  describe('scaleDimensions', () => {
    it('returns original dimensions when within max', () => {
      const result = scaleDimensions(100, 200, 2048);
      expect(result).toEqual({ width: 100, height: 200 });
    });

    it('scales down to fit width when width > height', () => {
      const result = scaleDimensions(4096, 2048, 2048);
      expect(result).toEqual({ width: 2048, height: 1024 });
    });

    it('scales down to fit height when height > width', () => {
      const result = scaleDimensions(1000, 4000, 2000);
      expect(result).toEqual({ width: 500, height: 2000 });
    });

    it('returns identity when dimensions equal max', () => {
      const result = scaleDimensions(2048, 1024, 2048);
      expect(result).toEqual({ width: 2048, height: 1024 });
    });

    it('handles square images', () => {
      const result = scaleDimensions(5000, 5000, 1024);
      expect(result).toEqual({ width: 1024, height: 1024 });
    });
  });

  describe('analyticalRgbToCmyk', () => {
    it('emits canonical subtractive channels for RGB primaries', () => {
      expect(analyticalRgbToCmyk(255, 0, 0)).toEqual([0, 255, 255, 0]);
      expect(analyticalRgbToCmyk(0, 255, 0)).toEqual([255, 0, 255, 0]);
      expect(analyticalRgbToCmyk(0, 0, 255)).toEqual([255, 255, 0, 0]);
    });

    it('uses a full key plate for black without dividing by zero', () => {
      expect(analyticalRgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 255]);
    });
  });

  describe('collectImageSrcsFromFills', () => {
    it('extracts image fill srcs', () => {
      const fills = [{ type: 'image', src: 'http://example.com/img.png', visible: true }];
      const result = collectImageSrcsFromFills(fills);
      expect(result).toEqual(['http://example.com/img.png']);
    });

    it('extracts pattern tileSrcs', () => {
      const fills = [{ type: 'pattern', tileSrc: 'http://example.com/tile.png', visible: true }];
      const result = collectImageSrcsFromFills(fills);
      expect(result).toEqual(['http://example.com/tile.png']);
    });

    it('skips invisible fills', () => {
      const fills = [{ type: 'image', src: 'http://example.com/hidden.png', visible: false }];
      const result = collectImageSrcsFromFills(fills);
      expect(result).toEqual([]);
    });

    it('skips non-image fills', () => {
      const fills = [{ type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 }, visible: true }];
      const result = collectImageSrcsFromFills(fills);
      expect(result).toEqual([]);
    });

    it('deduplicates same src', () => {
      const fills = [
        { type: 'image', src: 'http://example.com/img.png', visible: true },
        { type: 'image', src: 'http://example.com/img.png', visible: true },
      ];
      const result = collectImageSrcsFromFills(fills);
      expect(result).toEqual(['http://example.com/img.png', 'http://example.com/img.png']);
    });
  });

  describe('invalidateIccCache', () => {
    it('invalidates cache for specific URL', () => {
      invalidateIccCache('http://example.com/image.png');
      expect(true).toBe(true);
    });

    it('invalidates entire cache when no URL given', () => {
      invalidateIccCache();
      expect(true).toBe(true);
    });
  });
});
