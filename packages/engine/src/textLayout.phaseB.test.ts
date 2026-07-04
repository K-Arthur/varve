/**
 * Tests for textLayout Phase B: canvas measurement + CJK line breaking.
 */
import { describe, expect, it } from 'vitest';
import { layoutRichText } from './textLayout';
import type { RichTextInput } from './textLayout';

function makeRichText(text: string, fontSize = 16, fontFamily = 'Inter'): RichTextInput {
  return {
    paragraphs: [
      {
        runs: [{ text, format: { fontSize, fontFamily } }],
      },
    ],
  };
}

describe('layoutRichText — measurement', () => {
  it('produces non-zero width for simple text', () => {
    const result = layoutRichText(makeRichText('Hello World'), 200, {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.overset).toBe(false);
  });

  it('wraps text when exceeding maxWidth', () => {
    const result = layoutRichText(
      makeRichText('This is a very long line of text that should wrap'),
      100,
      { fontSize: 16, fontFamily: 'Inter' },
    );
    expect(result.lines.length).toBeGreaterThan(1);
  });

  it('handles empty text', () => {
    const result = layoutRichText(makeRichText(''), 200, { fontSize: 16, fontFamily: 'Inter' });
    expect(result.lines.length).toBe(0);
    expect(result.width).toBe(0);
  });

  it('handles single word', () => {
    const result = layoutRichText(makeRichText('Hello'), 200, {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(result.lines.length).toBe(1);
    expect(result.overset).toBe(false);
  });

  it('detects overset when maxLines is exceeded', () => {
    const richText: RichTextInput = {
      paragraphs: [
        {
          runs: [{ text: 'word '.repeat(50) }],
          format: { maxLines: 2 },
        },
      ],
    };
    const result = layoutRichText(richText, 50, { fontSize: 16, fontFamily: 'Inter' });
    expect(result.overset).toBe(true);
  });
});

describe('layoutRichText — CJK line breaking', () => {
  it('handles CJK text without spaces', () => {
    const cjkText =
      '\u4e2d\u6587\u5b57\u7b26\u6d4b\u8bd5\u8fd9\u662f\u4e00\u4e2a\u957f\u6587\u672c';
    const result = layoutRichText(makeRichText(cjkText, 16, 'Noto Sans CJK'), 80, {
      fontSize: 16,
      fontFamily: 'Noto Sans CJK',
    });
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
  });

  it('handles mixed CJK and Latin text', () => {
    const mixedText = 'Hello \u4e16\u754c World \u4e16\u754c Test';
    const result = layoutRichText(makeRichText(mixedText, 16, 'Noto Sans CJK'), 200, {
      fontSize: 16,
      fontFamily: 'Noto Sans CJK',
    });
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
  });

  it('wraps CJK text at narrow widths', () => {
    const cjkText =
      '\u4e2d\u6587\u5b57\u7b26\u6d4b\u8bd5\u8fd9\u662f\u4e00\u4e2a\u957f\u6587\u672c';
    const result = layoutRichText(makeRichText(cjkText, 16, 'Noto Sans CJK'), 32, {
      fontSize: 16,
      fontFamily: 'Noto Sans CJK',
    });
    expect(result.lines.length).toBeGreaterThan(1);
  });
});

describe('layoutRichText — multiple paragraphs', () => {
  it('handles multiple paragraphs', () => {
    const richText: RichTextInput = {
      paragraphs: [
        { runs: [{ text: 'First paragraph' }] },
        { runs: [{ text: 'Second paragraph' }] },
      ],
    };
    const result = layoutRichText(richText, 300, { fontSize: 16, fontFamily: 'Inter' });
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
  });

  it('handles mixed-format runs', () => {
    const richText: RichTextInput = {
      paragraphs: [
        {
          runs: [
            { text: 'Bold', format: { fontSize: 18, fontWeight: 700 } },
            { text: ' and normal', format: { fontSize: 14 } },
          ],
        },
      ],
    };
    const result = layoutRichText(richText, 300, { fontSize: 16, fontFamily: 'Inter' });
    expect(result.lines.length).toBe(1);
    expect(result.lines[0]?.runs.length).toBeGreaterThanOrEqual(2);
  });
});
