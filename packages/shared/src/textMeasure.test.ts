// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  buildFeatureSettingsCSS,
  buildVariationSettingsCSS,
  measureRichText,
  measureRun,
  measureText,
  measureTextWithCanvas,
  textWrap,
} from './textMeasure';

describe('measureText', () => {
  it('measures single-line text width using canvas measureText', () => {
    const result = measureText('Hello', { fontSize: 16, fontFamily: 'sans-serif' });
    expect(result.width).toBeGreaterThan(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.text).toBe('Hello');
  });

  it('returns zero width for empty string', () => {
    const result = measureText('', { fontSize: 16, fontFamily: 'sans-serif' });
    expect(result.width).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.text).toBe('');
  });

  it('accounts for letterSpacing in total width', () => {
    const normal = measureText('Hello', { fontSize: 16, fontFamily: 'sans-serif' });
    const spaced = measureText('Hello', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      letterSpacing: 2,
    });
    expect(spaced.width).toBeGreaterThan(normal.width);
  });

  it('accounts for lineHeight in total height', () => {
    const tight = measureText('Hello\nWorld', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      lineHeight: 1.2,
    });
    const loose = measureText('Hello\nWorld', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      lineHeight: 2.0,
    });
    expect(loose.height).toBeGreaterThan(tight.height);
  });

  it('handles multi-line text with correct line count', () => {
    const result = measureText('Line 1\nLine 2\nLine 3', {
      fontSize: 16,
      fontFamily: 'sans-serif',
    });
    expect(result.lines).toHaveLength(3);
  });

  it('applies textCase uppercase transform before measurement', () => {
    const result = measureText('hello', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      textCase: 'uppercase',
    });
    expect(result.lines[0]?.text).toBe('HELLO');
  });

  it('applies textCase capitalize transform', () => {
    const result = measureText('hello world', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      textCase: 'capitalize',
    });
    expect(result.lines[0]?.text).toBe('Hello World');
  });
});

describe('textWrap', () => {
  it('does not wrap text shorter than maxWidth', () => {
    const lines = textWrap('Hello', 500, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Hello');
  });

  it('wraps text at word boundaries', () => {
    const lines = textWrap('one two three four', 50, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('does not break when no spaces exist and text fits', () => {
    const lines = textWrap('Supercalifragilistic', 500, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(1);
  });

  it('respects newlines as explicit breaks', () => {
    const lines = textWrap('Hello\nWorld', 500, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(2);
  });

  it('returns empty array for empty string', () => {
    const lines = textWrap('', 100, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(0);
  });
});

describe('measureTextWithCanvas', () => {
  function createMockCtx(width: number): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    vi.spyOn(ctx, 'measureText').mockReturnValue({
      width,
      actualBoundingBoxAscent: 14,
      actualBoundingBoxDescent: 4,
      fontBoundingBoxAscent: 16,
      fontBoundingBoxDescent: 4,
    } as unknown as TextMetrics);
    return ctx;
  }

  it('returns accurate width from canvas measureText', () => {
    const ctx = createMockCtx(120);
    const result = measureTextWithCanvas(ctx, 'Hello', { fontSize: 16, fontFamily: 'Arial' });
    expect(result.width).toBe(120);
    expect(result.actualBoundingBoxAscent).toBe(14);
    expect(result.actualBoundingBoxDescent).toBe(4);
  });

  it('returns zero width for empty string', () => {
    const ctx = createMockCtx(0);
    const result = measureTextWithCanvas(ctx, '', { fontSize: 16, fontFamily: 'Arial' });
    expect(result.width).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.text).toBe('');
  });

  it('includes fontMetrics in result', () => {
    const ctx = createMockCtx(80);
    const result = measureTextWithCanvas(ctx, 'Test', { fontSize: 16, fontFamily: 'Arial' });
    expect(result.fontMetrics.ascent).toBeGreaterThan(0);
    expect(result.fontMetrics.descent).toBeGreaterThan(0);
  });

  it('handles multi-line text with canvas measurement', () => {
    const ctx = createMockCtx(60);
    const result = measureTextWithCanvas(ctx, 'Line 1\nLine 2', {
      fontSize: 16,
      fontFamily: 'Arial',
    });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.text).toBe('Line 1');
    expect(result.lines[1]?.text).toBe('Line 2');
  });

  it('applies letterSpacing to width', () => {
    const ctx = createMockCtx(60);
    const result = measureTextWithCanvas(ctx, 'abc', {
      fontSize: 16,
      fontFamily: 'Arial',
      letterSpacing: 3,
    });
    // letterSpacing adds (n-1) * spacing = 2 * 3 = 6 extra px
    expect(result.width).toBe(66);
  });

  it('uses total height from lineHeight', () => {
    const ctx = createMockCtx(40);
    const result = measureTextWithCanvas(ctx, 'Hello\nWorld', {
      fontSize: 16,
      fontFamily: 'Arial',
      lineHeight: 2.0,
    });
    expect(result.lines[0]?.height).toBe(32);
    expect(result.lines[1]?.height).toBe(32);
    expect(result.height).toBe(64);
  });

  it('applies textCase transform before measurement', () => {
    const ctx = createMockCtx(50);
    const result = measureTextWithCanvas(ctx, 'hello', {
      fontSize: 16,
      fontFamily: 'Arial',
      textCase: 'uppercase',
    });
    expect(result.lines[0]?.text).toBe('HELLO');
  });

  it('sets ctx.font from options before measuring', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const measureSpy = vi.spyOn(ctx, 'measureText').mockReturnValue({
      width: 100,
      actualBoundingBoxAscent: 14,
      actualBoundingBoxDescent: 4,
    } as unknown as TextMetrics);

    measureTextWithCanvas(ctx, 'Hello', {
      fontSize: 16,
      fontFamily: 'Arial',
      fontWeight: 700,
      fontStyle: 'italic',
    });

    expect(ctx.font).toContain('italic');
    expect(ctx.font).toContain('700');
    expect(ctx.font).toContain('16px');
    expect(ctx.font).toContain('Arial');
    expect(measureSpy).toHaveBeenCalledWith('Hello');
  });

  it('textWrap uses canvas metrics when ctx provided', () => {
    const ctx = createMockCtx(30);
    const lines = textWrap('one two three four', 80, { fontSize: 16, fontFamily: 'Arial' }, ctx);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('textWrap falls back to estimate when no ctx provided', () => {
    const lines = textWrap('one two three four', 80, { fontSize: 16, fontFamily: 'Arial' });
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

describe('measureRun', () => {
  it('measures a single text run with default format', () => {
    const result = measureRun('Hello', { fontSize: 16, fontFamily: 'sans-serif' });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.text).toBe('Hello');
  });

  it('applies textCase transform', () => {
    const result = measureRun('hello', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      textCase: 'uppercase',
    });
    expect(result.text).toBe('HELLO');
  });

  it('accounts for letterSpacing', () => {
    const normal = measureRun('Hello', { fontSize: 16, fontFamily: 'sans-serif' });
    const spaced = measureRun('Hello', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      letterSpacing: 5,
    });
    expect(spaced.width).toBeGreaterThan(normal.width);
  });

  it('uses canvas ctx when provided', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    vi.spyOn(ctx, 'measureText').mockReturnValue({
      width: 100,
      actualBoundingBoxAscent: 14,
      actualBoundingBoxDescent: 4,
    } as unknown as TextMetrics);
    const result = measureRun('Test', { fontSize: 16, fontFamily: 'Arial' }, ctx);
    expect(result.width).toBe(100);
  });
});

describe('measureRichText', () => {
  it('measures multiple paragraphs with runs', () => {
    const result = measureRichText(
      [{ runs: [{ text: 'Hello' }, { text: ' World' }] }, { runs: [{ text: 'Second line' }] }],
      { fontSize: 16, fontFamily: 'sans-serif' },
    );
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0]?.runs).toHaveLength(2);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('uses per-run format overrides', () => {
    const result = measureRichText(
      [
        {
          runs: [
            { text: 'Small', format: { fontSize: 12, fontFamily: 'sans-serif' } },
            { text: 'Big', format: { fontSize: 32, fontFamily: 'sans-serif' } },
          ],
        },
      ],
      { fontSize: 16, fontFamily: 'sans-serif' },
    );
    expect(result.paragraphs[0]?.runs[0]?.format.fontSize).toBe(12);
    expect(result.paragraphs[0]?.runs[1]?.format.fontSize).toBe(32);
    expect(result.paragraphs[0]?.runs[1]?.width).toBeGreaterThan(
      result.paragraphs[0]?.runs[0]?.width ?? 0,
    );
  });

  it('handles empty paragraphs', () => {
    const result = measureRichText([], { fontSize: 16, fontFamily: 'sans-serif' });
    expect(result.paragraphs).toHaveLength(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });
});

describe('buildVariationSettingsCSS', () => {
  it('returns undefined for empty settings', () => {
    expect(buildVariationSettingsCSS(undefined)).toBeUndefined();
    expect(buildVariationSettingsCSS({})).toBeUndefined();
  });

  it('builds CSS for variable font axes', () => {
    const css = buildVariationSettingsCSS({ wght: 500, wdth: 75 });
    expect(css).toContain('font-variation-settings');
    expect(css).toContain('"wght" 500');
    expect(css).toContain('"wdth" 75');
  });
});

describe('buildFeatureSettingsCSS', () => {
  it('returns undefined for empty features', () => {
    expect(buildFeatureSettingsCSS(undefined)).toBeUndefined();
    expect(buildFeatureSettingsCSS({})).toBeUndefined();
  });

  it('builds CSS for OpenType features', () => {
    const css = buildFeatureSettingsCSS({ liga: true, kern: true, dlig: false });
    expect(css).toContain('font-feature-settings');
    expect(css).toContain('"liga" 1');
    expect(css).toContain('"kern" 1');
    expect(css).toContain('"dlig" 0');
  });
});
