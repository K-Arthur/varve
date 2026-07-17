import { describe, expect, it } from 'vitest';
import { checkContrast, checkFillContrast, checkGradientContrast } from './wcagFix';

describe('checkContrast', () => {
  it('returns PASS for high-contrast colors (black on white)', () => {
    const result = checkContrast(
      { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    );
    expect(result.passes).toBe(true);
    expect(result.level).toBe('AAA');
  });

  it('returns FAIL for low-contrast colors (light gray on white)', () => {
    const result = checkContrast(
      { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    );
    expect(result.passes).toBe(false);
    expect(result.level).toBe('FAIL');
  });

  it('fails AA for medium-gray on white (ratio < 4.5)', () => {
    const result = checkContrast(
      { space: 'rgb', r: 150, g: 150, b: 150, a: 255 },
      { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    );
    expect(result.passes).toBe(false);
    expect(result.ratio).toBeLessThan(4.5);
  });

  it('uses large-text threshold for fontSize >= 24px', () => {
    const result = checkContrast(
      { space: 'rgb', r: 145, g: 145, b: 145, a: 255 },
      { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      { fontSize: 24 },
    );
    expect(result.passes).toBe(true);
  });

  it('returns warning when background is null', () => {
    const result = checkContrast({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, null);
    expect(result.warning).toBeTruthy();
  });

  it('provides an autoFix function', () => {
    const result = checkContrast(
      { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    );
    expect(result.autoFix).toBeDefined();
    const fixed = result.autoFix!();
    expect(fixed.space).toBe('rgb');
  });

  it('handles transparent foreground', () => {
    const result = checkContrast(
      { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    );
    expect(result.warning).toBeTruthy();
  });

  it('handles rgba with partial opacity', () => {
    const result = checkContrast(
      { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
      { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    );
    expect(result.ratio).toBeGreaterThanOrEqual(1);
  });
});

describe('checkFillContrast', () => {
  it('checks the topmost visible solid fill', () => {
    const fills = [
      {
        type: 'solid' as const,
        color: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ];
    const result = checkFillContrast(fills, { space: 'rgb', r: 255, g: 255, b: 255, a: 255 });
    expect(result.passes).toBe(false);
  });

  it('returns warning for gradient fills', () => {
    const fills = [
      {
        type: 'gradient' as const,
        gradient: {
          type: 'linear' as const,
          stops: [
            { position: 0, color: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ];
    const result = checkFillContrast(fills, { space: 'rgb', r: 255, g: 255, b: 255, a: 255 });
    expect(result.warning).toBeTruthy();
  });

  it('skips invisible fills', () => {
    const fills = [
      {
        type: 'solid' as const,
        color: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: false,
      },
      {
        type: 'solid' as const,
        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ];
    const result = checkFillContrast(fills, { space: 'rgb', r: 255, g: 255, b: 255, a: 255 });
    expect(result.passes).toBe(true);
  });
});

describe('checkGradientContrast', () => {
  it('checks worst-case stop contrast', () => {
    const stops = [
      { position: 0, color: { space: 'rgb' as const, r: 230, g: 230, b: 230, a: 255 } },
      { position: 1, color: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 } },
    ];
    const result = checkGradientContrast(stops, { space: 'rgb', r: 255, g: 255, b: 255, a: 255 });
    expect(result.passes).toBe(false);
  });

  it('handles empty stops', () => {
    const result = checkGradientContrast([], { space: 'rgb', r: 255, g: 255, b: 255, a: 255 });
    expect(result.warning).toBeTruthy();
  });
});
