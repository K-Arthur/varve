/**
 * Tests for grapheme-cluster utilities used by glyph-level typography.
 */
import { describe, expect, it } from 'vitest';
import {
  clusterIndexAtUtf16,
  clusterLabel,
  clusterStartUtf16,
  graphemeClusterCount,
  graphemeClusters,
} from './grapheme';

describe('grapheme clusters', () => {
  it('splits ASCII text into one cluster per character', () => {
    expect(graphemeClusters('STRATA')).toEqual(['S', 'T', 'R', 'A', 'T', 'A']);
    expect(graphemeClusterCount('STRATA')).toBe(6);
  });

  it('keeps combining marks in the same cluster', () => {
    const clusters = graphemeClusters('e\u0301x'); // é as e + combining acute
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toBe('e\u0301');
    expect(clusters[1]).toBe('x');
  });

  it('keeps emoji ZWJ sequences in one cluster', () => {
    const clusters = graphemeClusters('a\u{1F468}\u200D\u{1F469}b');
    expect(clusters).toHaveLength(3);
    expect(clusters[1]).toBe('\u{1F468}\u200D\u{1F469}');
  });

  it('handles empty text', () => {
    expect(graphemeClusters('')).toEqual([]);
    expect(graphemeClusterCount('')).toBe(0);
  });

  it('maps cluster index to UTF-16 offsets', () => {
    const text = 'A\u{1F600}B'; // A, emoji (2 units), B
    expect(clusterStartUtf16(text, 0)).toBe(0);
    expect(clusterStartUtf16(text, 1)).toBe(1);
    expect(clusterStartUtf16(text, 2)).toBe(3);
    expect(clusterStartUtf16(text, 9)).toBe(4);
  });

  it('maps UTF-16 offsets to cluster indices', () => {
    const text = 'AB\u0301C'; // A, B + combining, C
    expect(clusterIndexAtUtf16(text, 0)).toBe(0);
    expect(clusterIndexAtUtf16(text, 1)).toBe(1);
    expect(clusterIndexAtUtf16(text, 2)).toBe(1);
    expect(clusterIndexAtUtf16(text, 3)).toBe(2);
    expect(clusterIndexAtUtf16(text, 99)).toBe(2);
  });

  it('labels spaces and newlines for UI display', () => {
    expect(clusterLabel('A B', 1)).toBe('␣');
    expect(clusterLabel('A\nB', 1)).toBe('⏎');
    expect(clusterLabel('AB', 5)).toBe('—');
    expect(clusterLabel('AB', 0)).toBe('A');
  });
});
