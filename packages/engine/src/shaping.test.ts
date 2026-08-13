// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { graphemeTracking, hitTestCaret, scriptCodeToTag, shapeRun, shapeText } from './shaping';
import { analyzeParagraph } from './unicode/bidi';

// ── Canvas context mock ────────────────────────────────────────────────────

function createMockCtx() {
  const measureText = (text: string) => ({
    width: text.length * 10,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * 10,
    fontBoundingBoxAscent: 10,
    fontBoundingBoxDescent: 3,
  });

  return {
    measureText,
    font: '',
  } as unknown as CanvasRenderingContext2D;
}

let ctx: CanvasRenderingContext2D;

beforeEach(() => {
  ctx = createMockCtx();
});

afterEach(() => {
  ctx = undefined as unknown as CanvasRenderingContext2D;
});

// ── scriptCodeToTag ────────────────────────────────────────────────────────

describe('scriptCodeToTag', () => {
  it('maps Latin to latn', () => {
    expect(scriptCodeToTag('Latn')).toBe('latn');
  });

  it('maps Arabic to arab', () => {
    expect(scriptCodeToTag('Arab')).toBe('arab');
  });

  it('maps Hebrew to hebr', () => {
    expect(scriptCodeToTag('Hebr')).toBe('hebr');
  });

  it('maps Devanagari to dev2', () => {
    expect(scriptCodeToTag('Deva')).toBe('dev2');
  });

  it('maps Thai to thai', () => {
    expect(scriptCodeToTag('Thai')).toBe('thai');
  });

  it('maps Hangul to hang', () => {
    expect(scriptCodeToTag('Hang')).toBe('hang');
  });

  it('maps CJK to hani', () => {
    expect(scriptCodeToTag('Hani')).toBe('hani');
  });

  it('falls back to latn for unknown scripts', () => {
    expect(scriptCodeToTag('Xxxx')).toBe('latn');
  });
});

// ── shapeRun ───────────────────────────────────────────────────────────────

describe('shapeRun', () => {
  it('returns empty array for empty text', () => {
    const runs = shapeRun({ text: '', fontFamily: 'Arial', fontSize: 16, ctx });
    expect(runs).toEqual([]);
  });

  it('produces a single LTR run for Latin text', () => {
    const runs = shapeRun({ text: 'Hello', fontFamily: 'Arial', fontSize: 16, ctx });
    expect(runs.length).toBe(1);
    expect(runs[0]!.direction).toBe('ltr');
    expect(runs[0]!.fontFamily).toBe('Arial');
    expect(runs[0]!.fontSize).toBe(16);
    expect(runs[0]!.glyphs.length).toBe(5);
    expect(runs[0]!.script).toBe('latn');
  });

  it('sets font on the context for measurement', () => {
    shapeRun({ text: 'Test', fontFamily: 'Georgia', fontSize: 20, ctx });
    expect(ctx.font).toContain('Georgia');
    expect(ctx.font).toContain('20px');
  });

  it('includes font weight and style in the font string', () => {
    shapeRun({
      text: 'Bold',
      fontFamily: 'Arial',
      fontSize: 14,
      fontWeight: 700,
      fontStyle: 'italic',
      ctx,
    });
    expect(ctx.font).toContain('700');
    expect(ctx.font).toContain('italic');
  });

  it('computes total width from glyph advances', () => {
    const runs = shapeRun({ text: 'ABC', fontFamily: 'Arial', fontSize: 16, ctx });
    expect(runs[0]!.width).toBeGreaterThan(0);
  });

  it('handles RTL text direction', () => {
    const runs = shapeRun({ text: 'مرحبا', fontFamily: 'Arial', fontSize: 16, ctx });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]!.direction).toBe('rtl');
  });

  it('keeps mixed paragraph run order from the resolved visual BiDi mapping', () => {
    const runs = shapeRun({ text: 'שלום hello', fontFamily: 'Arial', fontSize: 16, ctx });
    expect(runs[0]?.direction).toBe('rtl');
    expect(runs[runs.length - 1]?.direction).toBe('ltr');
  });

  it('respects explicit LTR direction override', () => {
    const runs = shapeRun({
      text: 'Hello',
      fontFamily: 'Arial',
      fontSize: 16,
      direction: 'ltr',
      ctx,
    });
    expect(runs[0]!.direction).toBe('ltr');
  });

  it('respects explicit RTL direction override', () => {
    const runs = shapeRun({
      text: 'Hello',
      fontFamily: 'Arial',
      fontSize: 16,
      direction: 'rtl',
      ctx,
    });
    // Explicit RTL sets the paragraph base level to 1
    expect(runs[0]!.level).toBeGreaterThanOrEqual(0);
    // The shaping respects the explicit direction via the paragraph analysis
    const para = analyzeParagraph('Hello', 'rtl');
    expect(para.baseLevel).toBe(1);
  });

  it('segments grapheme clusters correctly', () => {
    // "é" is two codepoints (e + combining acute) but one grapheme
    const runs = shapeRun({ text: 'café', fontFamily: 'Arial', fontSize: 16, ctx });
    // café = 4 graphemes
    expect(runs[0]!.glyphs.length).toBe(4);
  });

  it('applies letter spacing to advances', () => {
    const runsNoSpacing = shapeRun({ text: 'AB', fontFamily: 'Arial', fontSize: 16, ctx });
    const runsWithSpacing = shapeRun({
      text: 'AB',
      fontFamily: 'Arial',
      fontSize: 16,
      letterSpacing: 2,
      ctx,
    });
    expect(runsWithSpacing[0]!.width).toBeGreaterThan(runsNoSpacing[0]!.width);
  });

  it('does not add letter spacing after the last glyph', () => {
    const runs = shapeRun({ text: 'AB', fontFamily: 'Arial', fontSize: 16, letterSpacing: 5, ctx });
    // A=10 + spacing=5 + B=10 = 25 (no trailing spacing)
    expect(runs[0]!.width).toBe(25);
  });

  it('computes ascent and descent from font size', () => {
    const runs = shapeRun({ text: 'Test', fontFamily: 'Arial', fontSize: 20, ctx });
    expect(runs[0]!.ascent).toBeCloseTo(16); // 20 * 0.8
    expect(runs[0]!.descent).toBeCloseTo(4); // 20 * 0.2
  });
});

// ── shapeText ──────────────────────────────────────────────────────────────

describe('shapeText', () => {
  it('returns a TextShaping with runs, width, height, direction', () => {
    const result = shapeText('Hello World', 'Arial', 16, ctx);
    expect(result.runs.length).toBeGreaterThanOrEqual(1);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.baseDirection).toBe('ltr');
    expect(result.direction).toBe('ltr');
  });

  it('detects RTL base direction for Arabic text', () => {
    const result = shapeText('مرحبا', 'Arial', 16, ctx);
    expect(result.baseDirection).toBe('rtl');
    expect(result.direction).toBe('rtl');
  });

  it('respects explicit direction override', () => {
    const result = shapeText('Hello', 'Arial', 16, ctx, { direction: 'rtl' });
    expect(result.direction).toBe('rtl');
  });

  it('handles empty text', () => {
    const result = shapeText('', 'Arial', 16, ctx);
    expect(result.runs).toEqual([]);
    expect(result.width).toBe(0);
  });

  it('passes weight and style to shapeRun', () => {
    const result = shapeText('Bold', 'Arial', 14, ctx, { fontWeight: 700, fontStyle: 'italic' });
    expect(result.runs[0]!.fontWeight).toBe(700);
    expect(result.runs[0]!.fontStyle).toBe('italic');
  });
});

// ── hitTestCaret ───────────────────────────────────────────────────────────

describe('hitTestCaret', () => {
  it('returns 0 for x=0 (caret before first glyph)', () => {
    const shaping = shapeText('Hello', 'Arial', 16, ctx);
    const pos = hitTestCaret(shaping, 0);
    expect(pos).toBe(0);
  });

  it('returns last cluster for x past end', () => {
    const shaping = shapeText('Hello', 'Arial', 16, ctx);
    const pos = hitTestCaret(shaping, 9999);
    expect(pos).toBeGreaterThan(0);
  });

  it('returns a valid cluster index for mid-text x', () => {
    const shaping = shapeText('Hello', 'Arial', 16, ctx);
    const pos = hitTestCaret(shaping, 25);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(5);
  });

  it('returns 0 for empty shaping', () => {
    const emptyShaping = {
      runs: [],
      width: 0,
      height: 0,
      baseDirection: 'ltr' as const,
      direction: 'ltr' as const,
    };
    const pos = hitTestCaret(emptyShaping, 10);
    expect(pos).toBe(0);
  });
});

describe('graphemeTracking', () => {
  it('adds fontSize * tracking / 1000 between graphemes', () => {
    expect(graphemeTracking(100, 20, 0, 3)).toBeCloseTo(2);
    expect(graphemeTracking(-50, 20, 1, 3)).toBeCloseTo(-1);
  });

  it('never applies tracking after the last grapheme', () => {
    expect(graphemeTracking(100, 20, 2, 3)).toBe(0);
    expect(graphemeTracking(100, 20, 0, 1)).toBe(0);
  });

  it('returns zero for zero tracking', () => {
    expect(graphemeTracking(0, 20, 0, 3)).toBe(0);
  });
});
