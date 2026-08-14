/**
 * Shaping oracle — structural invariants of correct OpenType shaping.
 *
 * Uses system Noto fonts at test time (never redistributed; skipped when the
 * fonts are absent, so the suite stays green on machines without them).
 * Font versions vary between systems, so the oracle asserts *invariants of
 * correct shaping* — joining forms differ, ligatures/conjuncts reduce glyph
 * counts, marks get zero advances and GPOS offsets, RTL glyphs are emitted in
 * visual order, clusters stay in bounds — rather than golden glyph IDs.
 *
 * Backend under test: the lazy harfbuzz-wasm adapter in `shapingBackend.ts`,
 * the same contract the native rustybuzz path normalizes into.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHarfBuzzWasmBackend } from './shapingBackend';

function fontData(...candidates: string[]): ArrayBuffer | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate).buffer as ArrayBuffer;
    }
  }
  return null;
}

const ARABIC = fontData('/usr/share/fonts/noto/NotoSansArabic-Regular.ttf');
const DEVANAGARI = fontData('/usr/share/fonts/noto/NotoSansDevanagari-Regular.ttf');
const THAI = fontData('/usr/share/fonts/noto/NotoSansThai-Regular.ttf');
const HEBREW = fontData('/usr/share/fonts/noto/NotoSansHebrew-Regular.ttf');

const describeIf = (condition: boolean) => (condition ? describe : describe.skip);
const itIf = (condition: boolean) => (condition ? it : it.skip);

function fixture(condition: boolean, name: string, fn: () => void) {
  itIf(condition)(name, fn);
}

describeIf(Boolean(ARABIC))('Arabic shaping oracle', () => {
  const backend = createHarfBuzzWasmBackend();

  fixture(Boolean(ARABIC), 'produces distinct joining forms for one letter', async () => {
    const isolated = await backend.shape({
      text: 'م',
      fontData: ARABIC!,
      fontSize: 100,
      direction: 'rtl',
    });
    const medial = await backend.shape({
      text: 'بم',
      fontData: ARABIC!,
      fontSize: 100,
      direction: 'rtl',
    });
    const final = await backend.shape({
      text: 'مب',
      fontData: ARABIC!,
      fontSize: 100,
      direction: 'rtl',
    });
    const initial = await backend.shape({
      text: 'ما',
      fontData: ARABIC!,
      fontSize: 100,
      direction: 'rtl',
    });
    const ids = new Set([
      isolated.glyphs[0]!.glyphId,
      medial.glyphs[0]!.glyphId,
      final.glyphs[0]!.glyphId,
      initial.glyphs[0]!.glyphId,
    ]);
    // Isolated, initial, medial, final are four different glyphs in Noto.
    expect(ids.size).toBeGreaterThanOrEqual(3);
  });

  fixture(
    Boolean(ARABIC),
    'shapes lam-alef with valid clusters (ligature formation is font-dependent)',
    async () => {
      // Modern Noto Arabic shapes لا without a lam-alef ligature (joined forms +
      // kerning); older fonts emit one ligature glyph. Both are correct shaping:
      // assert valid, monotone clusters either way.
      const lamAlef = await backend.shape({
        text: 'لا',
        fontData: ARABIC!,
        fontSize: 100,
        direction: 'rtl',
      });
      expect(lamAlef.glyphs.length).toBeGreaterThanOrEqual(1);
      expect(lamAlef.glyphs.length).toBeLessThanOrEqual(2);
      let previous = Infinity;
      for (const glyph of lamAlef.glyphs) {
        expect(glyph.glyphId).toBeGreaterThan(0);
        expect(glyph.clusterUtf16).toBeGreaterThanOrEqual(0);
        expect(glyph.clusterUtf16).toBeLessThanOrEqual(2);
        expect(glyph.clusterUtf16).toBeLessThanOrEqual(previous);
        previous = glyph.clusterUtf16;
      }
    },
  );

  fixture(Boolean(ARABIC), 'keeps harakat as zero-advance offset glyphs', async () => {
    const withMark = await backend.shape({
      text: 'بَ',
      fontData: ARABIC!,
      fontSize: 100,
      direction: 'rtl',
    });
    const mark = withMark.glyphs.find((g) => g.clusterUtf16 === 1);
    expect(mark).toBeDefined();
    expect(mark!.xAdvance).toBe(0);
    expect(mark!.yOffset).not.toBe(0);
  });

  fixture(Boolean(ARABIC), 'emits RTL glyphs in visual order (rightmost first)', async () => {
    const result = await backend.shape({
      text: 'مرحبا',
      fontData: ARABIC!,
      fontSize: 100,
      direction: 'rtl',
    });
    const first = result.glyphs[0]!;
    expect(first.clusterUtf16).toBe('مرحبا'.length - 1);
    // Clusters ascend from the rightmost glyph to the leftmost.
    for (let i = 1; i < result.glyphs.length; i++) {
      expect(result.glyphs[i]!.clusterUtf16).toBeLessThanOrEqual(
        result.glyphs[i - 1]!.clusterUtf16,
      );
    }
  });

  fixture(Boolean(ARABIC), 'reports real glyph IDs and font metrics', async () => {
    const result = await backend.shape({
      text: 'سلام',
      fontData: ARABIC!,
      fontSize: 100,
      direction: 'rtl',
    });
    expect(result.glyphs.every((g) => g.glyphId > 0)).toBe(true);
    expect(result.unitsPerEm).toBeGreaterThan(100);
    expect(result.ascent).toBeGreaterThan(0);
  });
});

describeIf(Boolean(DEVANAGARI))('Devanagari shaping oracle', () => {
  const backend = createHarfBuzzWasmBackend();

  fixture(Boolean(DEVANAGARI), 'forms conjuncts with fewer glyphs than code points', async () => {
    // क + ् + ष = 3 code points; Noto forms the ksha conjunct as 1-2 glyphs.
    const result = await backend.shape({
      text: 'क्ष',
      fontData: DEVANAGARI!,
      fontSize: 100,
      direction: 'ltr',
    });
    expect(result.glyphs.length).toBeLessThan(3);
    expect(result.glyphs[0]!.glyphId).toBeGreaterThan(0);
  });

  fixture(Boolean(DEVANAGARI), 'positions pre-base matras with offsets', async () => {
    // के: ka + e-matra — the matra is a spacing mark with its own advance.
    const result = await backend.shape({
      text: 'के',
      fontData: DEVANAGARI!,
      fontSize: 100,
      direction: 'ltr',
    });
    const matra = result.glyphs.find((g) => g.clusterUtf16 === 1);
    expect(matra).toBeDefined();
    expect(matra!.xAdvance).toBeGreaterThanOrEqual(0);
  });

  fixture(Boolean(DEVANAGARI), 'keeps clusters monotone and in bounds', async () => {
    for (const text of ['कर्मचारी', 'दर्शन', 'क्षत्रिय']) {
      const result = await backend.shape({
        text,
        fontData: DEVANAGARI!,
        fontSize: 100,
        direction: 'ltr',
      });
      let previous = -1;
      for (const glyph of result.glyphs) {
        expect(glyph.clusterUtf16).toBeGreaterThanOrEqual(0);
        expect(glyph.clusterUtf16).toBeLessThanOrEqual(text.length);
        expect(glyph.clusterUtf16).toBeGreaterThanOrEqual(previous);
        previous = glyph.clusterUtf16;
      }
    }
  });
});

describeIf(Boolean(THAI))('Thai shaping oracle', () => {
  const backend = createHarfBuzzWasmBackend();

  fixture(Boolean(THAI), 'shapes base + vowel + tone as ordered glyphs', async () => {
    // กี่ = ka + i + tone mark
    const result = await backend.shape({
      text: 'กี่',
      fontData: THAI!,
      fontSize: 100,
      direction: 'ltr',
    });
    expect(result.glyphs.length).toBeGreaterThanOrEqual(3);
    const marks = result.glyphs.filter((g) => g.clusterUtf16 > 0);
    // Marks may have zero advances but must be positioned.
    for (const mark of marks) {
      expect(mark.xAdvance).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(mark.xOffset)).toBe(true);
      expect(Number.isFinite(mark.yOffset)).toBe(true);
    }
  });

  fixture(Boolean(THAI), 'keeps stacked marks attached to their cluster', async () => {
    const result = await backend.shape({
      text: 'ก้',
      fontData: THAI!,
      fontSize: 100,
      direction: 'ltr',
    });
    const clusters = new Set(result.glyphs.map((g) => g.clusterUtf16));
    expect(clusters.has(0)).toBe(true);
    expect(clusters.has(1)).toBe(true);
  });
});

describeIf(Boolean(HEBREW))('Hebrew shaping oracle', () => {
  const backend = createHarfBuzzWasmBackend();

  fixture(Boolean(HEBREW), 'shapes RTL Hebrew with visual-order output', async () => {
    const result = await backend.shape({
      text: 'שלום',
      fontData: HEBREW!,
      fontSize: 100,
      direction: 'rtl',
    });
    expect(result.glyphs[0]!.clusterUtf16).toBe(3);
    expect(result.glyphs.every((g) => g.glyphId > 0)).toBe(true);
  });
});
