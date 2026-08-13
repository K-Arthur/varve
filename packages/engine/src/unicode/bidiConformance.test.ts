/**
 * UAX #9 conformance corpus for the mandated mixed-direction examples.
 *
 * Fixtures are logical source strings; assertions cover base direction,
 * embedding levels, run structure, visual ordering, mirroring, and the
 * invariant that source text is never mutated or reordered.
 */

import { describe, expect, it } from 'vitest';
import { analyzeParagraph } from './bidi';
import { BIDI_FIXTURES } from '../text/fixtures';

function para(text: string) {
  return analyzeParagraph(text);
}

describe('UAX #9 conformance fixtures', () => {
  it('detects first-strong base direction for each mandated example', () => {
    expect(para(BIDI_FIXTURES.priceInArabic).baseDirection).toBe('ltr');
    expect(para(BIDI_FIXTURES.helloVarve).baseDirection).toBe('rtl');
    expect(para(BIDI_FIXTURES.versionLine).baseDirection).toBe('ltr');
    expect(para(BIDI_FIXTURES.emailAndArabic).baseDirection).toBe('ltr');
    expect(para(BIDI_FIXTURES.parensMixed).baseDirection).toBe('ltr');
    expect(para(BIDI_FIXTURES.pureArabic).baseDirection).toBe('rtl');
    expect(para(BIDI_FIXTURES.pureLatin).baseDirection).toBe('ltr');
  });

  it('resolves the Arabic word in an LTR sentence to level 1', () => {
    const p = para(BIDI_FIXTURES.priceInArabic);
    const arabicStart = p.text.indexOf('دولار');
    expect(p.levels![arabicStart]).toBe(1);
    expect(p.levels![0]).toBe(0);
    expect(p.levels![p.text.length - 1]).toBe(0);
  });

  it('resolves European numbers inside RTL to level 2', () => {
    const p = para(BIDI_FIXTURES.helloVarve);
    const digitStart = p.text.indexOf('2026');
    expect(p.levels![digitStart]).toBe(2);
  });

  it('keeps the mixed parenthesis example logical and structured', () => {
    const p = para(BIDI_FIXTURES.parensMixed);
    expect(p.text).toBe('(Hello שלום 123 مرحبا)');
    // Runs alternate direction across the phrase.
    expect(p.runs.some((run) => run.direction === 'rtl')).toBe(true);
    expect(p.runs.some((run) => run.direction === 'ltr')).toBe(true);
  });

  it('mirrors brackets that land in RTL context and leaves LTR brackets alone', () => {
    const inside = para('مرحبا (عالم)');
    const open = inside.text.indexOf('(');
    expect(inside.mirroredCharacters!.get(open)).toBe(')');

    const latin = para('(hello)');
    expect(latin.mirroredCharacters!.size).toBe(0);
  });

  it('treats explicit isolates as isolated runs', () => {
    const p = para(BIDI_FIXTURES.isolates);
    expect(p.baseDirection).toBe('rtl');
    const lriStart = p.text.indexOf('\u2066');
    const latinStart = lriStart + 1;
    expect(p.levels![latinStart]).toBeGreaterThanOrEqual(2);
    expect(p.levels![latinStart] % 2).toBe(0);
  });

  it('never mutates or reorders source text', () => {
    for (const fixture of Object.values(BIDI_FIXTURES)) {
      const p = para(fixture);
      expect(p.text).toBe(fixture);
      expect(p.runs.reduce((sum, run) => sum + (run.end - run.start), 0)).toBe(fixture.length);
    }
  });

  it('visualOrder is a permutation of the logical indices', () => {
    for (const fixture of Object.values(BIDI_FIXTURES)) {
      const p = para(fixture);
      const sorted = [...p.visualOrder!].sort((a, b) => a - b);
      expect(sorted).toEqual([...Array(fixture.length).keys()]);
    }
  });

  it('supports explicit paragraph direction overrides', () => {
    expect(analyzeParagraph('hello', 'rtl').baseDirection).toBe('rtl');
    expect(analyzeParagraph('مرحبا', 'ltr').baseDirection).toBe('ltr');
    expect(analyzeParagraph('مرحبا', 'auto').baseDirection).toBe('rtl');
  });

  it('handles punctuation-heavy technical strings without losing characters', () => {
    const email = BIDI_FIXTURES.emailAndArabic;
    const p = para(email);
    expect(p.visualOrder).toHaveLength(email.length);
    const url = BIDI_FIXTURES.urlInRtl;
    const urlP = para(url);
    expect(urlP.text).toBe(url);
  });
});
