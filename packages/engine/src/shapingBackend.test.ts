import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHarfBuzzWasmBackend, normalizeNativeShapedRun } from './shapingBackend';

function readArrayBuffer(path: string): ArrayBuffer {
  const bytes = readFileSync(path);
  return Uint8Array.from(bytes).buffer;
}

const OPEN_SANS = 'crates/varve-print/fixtures/OpenSans-Regular.ttf';
const ARABIC = '/usr/share/fonts/noto/NotoSansArabic-Regular.ttf';

describe('shaping backend contract', () => {
  it('normalizes native font units and preserves UTF-16 clusters', () => {
    const result = normalizeNativeShapedRun(
      {
        glyphs: [
          { glyph_id: 42, x_advance: 500, y_advance: 0, x_offset: 20, y_offset: -10, cluster: 0 },
          { glyph_id: 43, x_advance: 500, y_advance: 0, x_offset: 0, y_offset: 0, cluster: 2 },
        ],
        direction: 'rtl',
        script: 'Arab',
        units_per_em: 1000,
        ascent: 800,
        descent: -200,
      },
      'a\u{1f600}b',
      20,
    );
    expect(result.backend).toBe('rustybuzz-native');
    expect(result.direction).toBe('rtl');
    expect(result.glyphs[0]).toMatchObject({
      glyphId: 42,
      xAdvance: 10,
      xOffset: 0.4,
      yOffset: -0.2,
      clusterUtf16: 0,
    });
    expect(result.glyphs[1]!.clusterUtf16).toBe(2);
    expect(result.glyphs[0]!.sourceEnd).toBe(2);
    expect(result.glyphs[1]!.sourceEnd).toBe(4);
    expect(result.ascent).toBe(16);
    expect(result.descent).toBe(4);
  });

  it('clamps malformed native cluster offsets to the source string', () => {
    const result = normalizeNativeShapedRun(
      {
        glyphs: [
          { glyph_id: 0, x_advance: 0, y_advance: 0, x_offset: 0, y_offset: 0, cluster: 999 },
        ],
        direction: 'unknown',
        script: 'DFLT',
      },
      'abc',
      12,
    );
    expect(result.glyphs[0]!.clusterUtf16).toBe(3);
    expect(result.direction).toBe('ltr');
    expect(result.missingGlyphIndices).toEqual([0]);
  });

  it.runIf(existsSync(OPEN_SANS))(
    'passes real numeric and ranged features to HarfBuzz',
    async () => {
      const backend = createHarfBuzzWasmBackend();
      const fontData = readArrayBuffer(OPEN_SANS);
      const enabled = await backend.shape({
        text: 'fi ffi',
        fontData,
        fontSize: 100,
        fontIdentity: 'fixture:opensans',
        features: { liga: true, ss01: 2 },
      });
      const disabled = await backend.shape({
        text: 'fi ffi',
        fontData,
        fontSize: 100,
        features: { liga: false },
      });

      expect(enabled.fontIdentity).toBe('fixture:opensans');
      expect(enabled.faceIndex).toBe(0);
      expect(enabled.glyphs.length).toBeLessThan(disabled.glyphs.length);
      expect(enabled.glyphs.every((glyph) => glyph.glyphId > 0)).toBe(true);
      expect(enabled.glyphs.every((glyph) => glyph.sourceEnd! <= 'fi ffi'.length)).toBe(true);

      const ranged = await backend.shape({
        text: 'fi fi',
        fontData,
        fontSize: 100,
        features: {
          liga: {
            value: false,
            ranges: [{ startUtf16: 3, endUtf16: 5, value: true }],
          },
        },
      });
      expect(ranged.glyphs.length).toBe(4);
      expect(ranged.glyphs.some((glyph) => glyph.clusterUtf16 === 3)).toBe(true);
    },
  );

  it.runIf(existsSync(ARABIC))(
    'reports inferred RTL direction when direction is omitted',
    async () => {
      const result = await createHarfBuzzWasmBackend().shape({
        text: 'سلام',
        fontData: readArrayBuffer(ARABIC),
        fontSize: 64,
      });
      expect(result.direction).toBe('rtl');
      expect(result.script).toBe('arab');
      expect(result.glyphs[0]!.clusterUtf16).toBe('سلام'.length - 1);
    },
  );
});
