import { describe, expect, it } from 'vitest';
import { computeLineDiff, LINE_DIFF_MAX_LINES } from './codeDiff';

describe('computeLineDiff', () => {
  it('reports no change for identical text', () => {
    expect(computeLineDiff('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0 });
  });

  it('counts only the lines that actually changed', () => {
    const before = 'one\ntwo\nthree\nfour';
    const after = 'one\nTWO\nthree\nfour';
    // The old summary subtracted lengths and reported +0 -0 for this edit.
    expect(computeLineDiff(before, after)).toEqual({ added: 1, removed: 1 });
  });

  it('reports pure additions and pure removals', () => {
    expect(computeLineDiff('a\nb', 'a\nb\nc\nd')).toEqual({ added: 2, removed: 0 });
    expect(computeLineDiff('a\nb\nc', 'a')).toEqual({ added: 0, removed: 2 });
  });

  it('does not report a net length delta for a reordering', () => {
    const before = 'a\nb\nc\nd';
    const after = 'b\na\nc\nd';
    const diff = computeLineDiff(before, after);
    expect(diff).not.toBeNull();
    // Same length, but content moved — the old summary said +0 -0.
    expect((diff?.added ?? 0) + (diff?.removed ?? 0)).toBeGreaterThan(0);
  });

  it('returns null rather than an approximation for oversized inputs', () => {
    const huge = Array.from({ length: LINE_DIFF_MAX_LINES + 1 }, (_, i) => `line ${i}`).join('\n');
    expect(computeLineDiff(huge, `${huge}\nextra`)).toBeNull();
  });

  it('handles empty text', () => {
    expect(computeLineDiff('', 'a')).toEqual({ added: 1, removed: 0 });
    expect(computeLineDiff('a', '')).toEqual({ added: 0, removed: 1 });
    expect(computeLineDiff('', '')).toEqual({ added: 0, removed: 0 });
  });
});
