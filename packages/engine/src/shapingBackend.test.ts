import { describe, expect, it } from 'vitest';
import { normalizeNativeShapedRun } from './shapingBackend';

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
});
