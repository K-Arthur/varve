/**
 * Tests for text-to-outlines conversion utility.
 */
import { describe, expect, it } from 'vitest';
import { glyphOutlineToSvgPath, textOutlinesToSvg, textToOutlines } from './textOutlines';

describe('textToOutlines', () => {
  it('converts simple text to glyph outlines', () => {
    const result = textToOutlines('Hello', {
      fontSize: 16,
      fontFamily: 'Inter',
      x: 0,
      y: 0,
    });
    expect(result.glyphs).toHaveLength(5);
    expect(result.isPlaceholder).toBe(true);
    expect(result.bounds.w).toBeGreaterThan(0);
    expect(result.bounds.h).toBeGreaterThan(0);
  });

  it('handles empty text', () => {
    const result = textToOutlines('', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(result.glyphs).toHaveLength(0);
    expect(result.bounds.w).toBe(0);
  });

  it('respects letterSpacing', () => {
    const noSpacing = textToOutlines('AB', {
      fontSize: 16,
      fontFamily: 'Inter',
      letterSpacing: 0,
    });
    const withSpacing = textToOutlines('AB', {
      fontSize: 16,
      fontFamily: 'Inter',
      letterSpacing: 10,
    });
    expect(withSpacing.bounds.w).toBeGreaterThan(noSpacing.bounds.w);
  });

  it('handles CJK characters with wider advance', () => {
    const latin = textToOutlines('A', {
      fontSize: 16,
      fontFamily: 'Noto Sans CJK',
    });
    const cjk = textToOutlines('\u4e2d', {
      fontSize: 16,
      fontFamily: 'Noto Sans CJK',
    });
    expect(cjk.glyphs[0]!.advance).toBeGreaterThan(latin.glyphs[0]!.advance);
  });

  it('handles newline characters', () => {
    const result = textToOutlines('A\nB', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(result.glyphs).toHaveLength(2);
  });

  it('produces 4 path points per glyph (rectangle placeholder)', () => {
    const result = textToOutlines('X', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(result.glyphs[0]!.points).toHaveLength(4);
  });
});

describe('glyphOutlineToSvgPath', () => {
  it('produces a valid SVG path string', () => {
    const result = textToOutlines('A', {
      fontSize: 16,
      fontFamily: 'Inter',
      x: 10,
      y: 20,
    });
    const path = glyphOutlineToSvgPath(result.glyphs[0]!);
    expect(path).toMatch(/^M /);
    expect(path).toMatch(/ Z$/);
    expect(path).toContain(' L ');
  });

  it('returns empty string for zero points', () => {
    const result = textToOutlines('A', { fontSize: 16, fontFamily: 'Inter' });
    const glyph = result.glyphs[0]!;
    const emptyGlyph = { ...glyph, points: [] };
    expect(glyphOutlineToSvgPath(emptyGlyph)).toBe('');
  });
});

describe('textOutlinesToSvg', () => {
  it('produces an SVG group element', () => {
    const result = textToOutlines('Hi', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    const svg = textOutlinesToSvg(result, '#ff0000');
    expect(svg).toContain('<g>');
    expect(svg).toContain('</g>');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('<path');
  });
});
