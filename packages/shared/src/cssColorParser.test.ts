import { describe, expect, it } from 'vitest';
import { cssStringToManagedColor, managedColorToCssString } from './cssColorParser';

function rgb(r: number, g: number, b: number, a = 255) {
  return { space: 'rgb' as const, r, g, b, a };
}

describe('cssStringToManagedColor', () => {
  describe('hex formats', () => {
    it('parses #RGB', () => {
      expect(cssStringToManagedColor('#F00')).toMatchObject(rgb(255, 0, 0));
    });

    it('parses #RRGGBB', () => {
      expect(cssStringToManagedColor('#ff8800')).toMatchObject(rgb(255, 136, 0));
    });

    it('parses #RGBA', () => {
      const result = cssStringToManagedColor('#F008');
      expect(result).toMatchObject(rgb(255, 0, 0, 136));
    });

    it('parses #RRGGBBAA', () => {
      const result = cssStringToManagedColor('#ff880080');
      expect(result).toMatchObject(rgb(255, 136, 0, 128));
    });
  });

  describe('rgb/rgba', () => {
    it('parses rgb with integer values', () => {
      expect(cssStringToManagedColor('rgb(255, 0, 128)')).toMatchObject(rgb(255, 0, 128));
    });

    it('parses rgb with percentage values', () => {
      expect(cssStringToManagedColor('rgb(100%, 0%, 50%)')).toMatchObject(rgb(255, 0, 128));
    });

    it('parses rgba with alpha', () => {
      const result = cssStringToManagedColor('rgba(255, 0, 0, 0.5)');
      expect(result).toMatchObject(rgb(255, 0, 0, 128));
    });
  });

  describe('hsl/hsla', () => {
    it('parses hsl', () => {
      const result = cssStringToManagedColor('hsl(0, 100%, 50%)');
      expect(result).toMatchObject(rgb(255, 0, 0));
    });

    it('parses hsla with alpha', () => {
      const result = cssStringToManagedColor('hsla(120, 100%, 50%, 0.25)');
      expect(result).toMatchObject(rgb(0, 255, 0, 64));
    });

    it('parses hsl with hue > 360', () => {
      const result = cssStringToManagedColor('hsl(720, 100%, 50%)');
      expect(result).toMatchObject(rgb(255, 0, 0));
    });

    it('parses hsl with negative hue', () => {
      const result = cssStringToManagedColor('hsl(-120, 100%, 50%)');
      // -120° normalizes to 240° = blue
      expect(result).toMatchObject(rgb(0, 0, 255));
    });
  });

  describe('named colors', () => {
    it('parses red', () => {
      expect(cssStringToManagedColor('red')).toMatchObject(rgb(255, 0, 0));
    });

    it('parses blue', () => {
      expect(cssStringToManagedColor('blue')).toMatchObject(rgb(0, 0, 255));
    });

    it('parses transparent with alpha 0', () => {
      const result = cssStringToManagedColor('transparent');
      expect(result).toMatchObject(rgb(0, 0, 0, 0));
    });

    it('is case-insensitive', () => {
      expect(cssStringToManagedColor('RED')).toMatchObject(rgb(255, 0, 0));
      expect(cssStringToManagedColor('Blue')).toMatchObject(rgb(0, 0, 255));
    });
  });

  describe('oklch/oklab', () => {
    it('parses oklch', () => {
      const result = cssStringToManagedColor('oklch(0.5 0.2 180)');
      expect(result).not.toBeNull();
      expect(result!.space).toBe('rgb');
      expect(result!.r).toBeGreaterThanOrEqual(0);
      expect(result!.r).toBeLessThanOrEqual(255);
    });

    it('parses oklab', () => {
      const result = cssStringToManagedColor('oklab(0.5 0.2 -0.1)');
      expect(result).not.toBeNull();
      expect(result!.space).toBe('rgb');
      expect(result!.r).toBeGreaterThanOrEqual(0);
      expect(result!.r).toBeLessThanOrEqual(255);
    });
  });

  describe('invalid input', () => {
    it('returns null for empty string', () => {
      expect(cssStringToManagedColor('')).toBeNull();
    });

    it('returns null for gibberish', () => {
      expect(cssStringToManagedColor('not a color')).toBeNull();
    });

    it('returns null for malformed hex', () => {
      expect(cssStringToManagedColor('#GGG')).toBeNull();
    });

    it('returns null for rgb with missing args', () => {
      expect(cssStringToManagedColor('rgb(255)')).toBeNull();
    });

    it('returns null for hsl with missing args', () => {
      expect(cssStringToManagedColor('hsl(100%)')).toBeNull();
    });
  });
});

describe('managedColorToCssString', () => {
  it('round-trips hex opacity=1 colors', () => {
    const colors = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [128, 64, 32, 255],
    ] as const;
    for (const [r, g, b, a] of colors) {
      const color = rgb(r, g, b, a);
      const css = managedColorToCssString(color);
      const parsed = cssStringToManagedColor(css);
      expect(parsed).toMatchObject(rgb(r, g, b, a));
    }
  });

  it('round-trips rgba with alpha', () => {
    const color = rgb(255, 0, 128, 64);
    const css = managedColorToCssString(color);
    const parsed = cssStringToManagedColor(css);
    expect(parsed).toMatchObject(rgb(255, 0, 128, 64));
  });

  it('round-trips hsl colors', () => {
    const testCases = ['hsl(0, 100%, 50%)', 'hsl(120, 50%, 75%)', 'hsla(240, 80%, 40%, 0.5)'];
    for (const css of testCases) {
      const parsed = cssStringToManagedColor(css)!;
      const cssOut = managedColorToCssString(parsed);
      const reparsed = cssStringToManagedColor(cssOut)!;
      expect(reparsed.r).toBeCloseTo(parsed.r, 0);
      expect(reparsed.g).toBeCloseTo(parsed.g, 0);
      expect(reparsed.b).toBeCloseTo(parsed.b, 0);
    }
  });
});
