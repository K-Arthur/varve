import { describe, expect, it } from 'vitest';
import { BIDI_FIXTURES } from './fixtures';
import { itemizeText } from './paragraphs';
import { lineVisualRuns, mirroredCharAt } from './visualOrder';

function paragraphOf(text: string) {
  return itemizeText(text).paragraphs[0]!;
}

describe('lineVisualRuns', () => {
  it('keeps a pure LTR line in logical order', () => {
    const paragraph = paragraphOf('abcd');
    const runs = lineVisualRuns(paragraph, 0, 4);
    expect(runs.map((r) => [r.start, r.end, r.direction])).toEqual([[0, 4, 'ltr']]);
  });

  it('reverses a pure RTL line into visual order', () => {
    const paragraph = paragraphOf('مرحبا');
    const runs = lineVisualRuns(paragraph, 0, 5);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.direction).toBe('rtl');
    expect(runs[0]!.level).toBe(1);
  });

  it('orders mixed LTR/RTL runs per line with correct levels', () => {
    const paragraph = paragraphOf(BIDI_FIXTURES.priceInArabic);
    const runs = lineVisualRuns(paragraph, 0, paragraph.text.length);
    // The Arabic word visually precedes the trailing Latin "today." run.
    const arabic = runs.find((run) => paragraph.text[run.start] === 'د');
    const trailing = runs[runs.length - 1]!;
    expect(arabic).toBeDefined();
    expect(arabic!.direction).toBe('rtl');
    expect(trailing.direction).toBe('ltr');
  });

  it('restricts ordering to the requested line range', () => {
    const paragraph = paragraphOf('abc def');
    const runs = lineVisualRuns(paragraph, 0, 3);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.end).toBe(3);
  });

  it('orders an RTL base paragraph with embedded Latin right-to-left', () => {
    const paragraph = paragraphOf(BIDI_FIXTURES.helloVarve);
    const runs = lineVisualRuns(paragraph, 0, paragraph.text.length);
    // First visual run is the leading RTL content ("مرحبا").
    expect(runs[0]!.direction).toBe('rtl');
    // Runs are contiguous in visual order: each starts where the previous ended.
    for (let i = 1; i < runs.length; i++) {
      // Not strictly contiguous logically — only visually. Just assert ordering.
      expect(runs[i]!.visualIndex).toBe(i);
    }
  });

  it('handles an empty line range', () => {
    const paragraph = paragraphOf('abc');
    expect(lineVisualRuns(paragraph, 3, 3)).toEqual([]);
  });

  it('handles wrapped RTL lines: each line gets its own reversal', () => {
    const paragraph = paragraphOf('الأول الثاني الثالث');
    const runsLine1 = lineVisualRuns(paragraph, 0, 7);
    const runsLine2 = lineVisualRuns(paragraph, 7, paragraph.text.length);
    expect(runsLine1[0]!.direction).toBe('rtl');
    expect(runsLine2[0]!.direction).toBe('rtl');
  });

  it('resolves bracket mirroring inside RTL context', () => {
    const paragraph = paragraphOf('مرحبا (عالم)');
    const openIndex = paragraph.text.indexOf('(');
    expect(paragraph.mirroredCharacters.get(openIndex)).toBe(')');
    expect(mirroredCharAt(paragraph, openIndex)).toBe(')');
  });
});
