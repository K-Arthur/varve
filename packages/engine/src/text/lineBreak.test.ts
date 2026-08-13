import { describe, expect, it } from 'vitest';
import { createUnicodeIndexMap } from '../unicode/unicodeIndices';
import { SCRIPT_FIXTURES } from './fixtures';
import { graphemeBreakUnits, segmentBreakUnits } from './lineBreak';

describe('segmentBreakUnits', () => {
  it('splits Latin text into words and spaces', () => {
    const units = segmentBreakUnits('hello world');
    expect(units.map((u) => [u.text, u.isWord, u.isWhitespace])).toEqual([
      ['hello', true, false],
      [' ', false, true],
      ['world', true, false],
    ]);
  });

  it('keeps punctuation attached to its word', () => {
    // ICU word segmentation emits letter runs and punctuation as separate
    // segments; punctuation-only segments are neither words nor whitespace
    // (breakable units that never split a word visually).
    const units = segmentBreakUnits('Hello, world!');
    expect(units.map((u) => u.text)).toEqual(['Hello', ',', ' ', 'world', '!']);
    const comma = units.find((u) => u.text === ',')!;
    expect(comma.isWord).toBe(false);
    expect(comma.isWhitespace).toBe(false);
    expect(units.find((u) => u.text === ' ')!.isBreakable).toBe(true);
  });

  it('treats NBSP as non-breaking whitespace (never a break opportunity)', () => {
    const units = segmentBreakUnits('a\u00a0b');
    expect(units.map((u) => u.text).join('')).toBe('a\u00a0b');
    const nbsp = units.find((u) => u.text === '\u00a0')!;
    expect(nbsp.isWhitespace).toBe(true);
    expect(nbsp.isBreakable).toBe(false);
  });

  it('splits at ZWSP as its own whitespace unit', () => {
    const units = segmentBreakUnits('ab\u200bcd');
    expect(units.map((u) => u.text)).toEqual(['ab', '\u200b', 'cd']);
    expect(units[1]!.isWhitespace).toBe(true);
    expect(units.map((u) => u.text).join('')).toBe('ab\u200bcd');
  });

  it('preserves CJK text without splitting inside words', () => {
    const units = segmentBreakUnits(SCRIPT_FIXTURES.cjk);
    expect(units.map((u) => u.text).join('')).toBe(SCRIPT_FIXTURES.cjk);
    expect(units.length).toBeGreaterThan(1);
  });

  it('never splits an extended grapheme cluster', () => {
    const invariants = [
      SCRIPT_FIXTURES.emojiZwj,
      SCRIPT_FIXTURES.emojiFlag,
      SCRIPT_FIXTURES.combining,
      'a\u0301b\u0301',
      '\u0915\u094d\u0937',
    ];
    for (const text of invariants) {
      const map = createUnicodeIndexMap(text);
      const graphemeBoundaries = new Set(map.graphemeBoundaries);
      for (const unit of segmentBreakUnits(text)) {
        expect(graphemeBoundaries.has(unit.start)).toBe(true);
        expect(graphemeBoundaries.has(unit.end)).toBe(true);
      }
    }
  });

  it('splits CJK ideographs into individual units', () => {
    const units = segmentBreakUnits(SCRIPT_FIXTURES.cjk);
    expect(units.length).toBeGreaterThanOrEqual(2);
    for (const unit of units) {
      expect([...unit.text].length).toBeLessThanOrEqual(5);
    }
  });

  it('treats a tab as its own whitespace unit', () => {
    const units = segmentBreakUnits('a\tb');
    expect(units.map((u) => u.isWhitespace)).toEqual([false, true, false]);
  });

  it('preserves Thai words via dictionary segmentation where available', () => {
    const units = segmentBreakUnits('ภาษาไทย');
    expect(units.length).toBeGreaterThan(0);
    expect(units.map((u) => u.text).join('')).toBe('ภาษาไทย');
  });

  it('handles empty text', () => {
    expect(segmentBreakUnits('')).toEqual([]);
  });
});

describe('graphemeBreakUnits', () => {
  it('splits an overlong word at grapheme boundaries', () => {
    const map = createUnicodeIndexMap('a\u0301bc');
    const units = graphemeBreakUnits(0, 4, 'a\u0301bc', map);
    expect(units.map((u) => u.text)).toEqual(['a\u0301', 'b', 'c']);
    expect(units.every((u) => u.isWord)).toBe(true);
  });
});
