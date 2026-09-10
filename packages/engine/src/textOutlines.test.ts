import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glyphOutlineToSvgPath, textOutlinesToSvg, textToOutlines } from './textOutlines';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const wawoff2: { decompress: (data: Uint8Array) => Promise<Uint8Array> } = require('wawoff2');

const GEIST_PATH = new URL(
  './font/__fixtures__/geist/geist-latin-wght-normal.woff2',
  import.meta.url,
);

async function loadFontData(): Promise<ArrayBuffer> {
  const woff2 = readFileSync(GEIST_PATH);
  const decompressed = await wawoff2.decompress(new Uint8Array(woff2));
  const copy = new Uint8Array(decompressed.length);
  copy.set(decompressed);
  return copy.buffer;
}

/** Synthetic policy variants of the licensed fixture; original bytes stay unchanged. */
function withEmbeddingFlags(original: ArrayBuffer, fsType: number, version: number): ArrayBuffer {
  const data = original.slice(0);
  const view = new DataView(data);
  let headOffset = 0;
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    const tag = view.getUint32(record);
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (tag === 0x68656164) headOffset = offset;
    if (tag !== 0x4f532f32) continue;
    view.setUint16(offset, version);
    view.setUint16(offset + 8, fsType);
    view.setUint32(record + 4, checksum(data.slice(offset, offset + length)));
  }
  view.setUint32(headOffset + 8, 0);
  view.setUint32(headOffset + 8, (0xb1b0afba - checksum(data)) >>> 0);
  return data;
}

function checksum(data: ArrayBuffer): number {
  const padded = new Uint8Array((data.byteLength + 3) & ~3);
  padded.set(new Uint8Array(data));
  const view = new DataView(padded.buffer);
  let value = 0;
  for (let i = 0; i < padded.byteLength; i += 4) value = (value + view.getUint32(i)) >>> 0;
  return value;
}

describe('textToOutlines — placeholder path (no fontData)', () => {
  it('converts simple text to glyph outlines', () => {
    const result = textToOutlines('Hello', {
      fontSize: 16,
      fontFamily: 'Inter',
      x: 0,
      y: 0,
    });
    expect(result.glyphs).toHaveLength(5);
    expect(result.isPlaceholder).toBe(true);
    expect(result.bounds.w).toBeGreaterThan(0);
  });

  it('handles empty text', () => {
    const result = textToOutlines('', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(result.glyphs).toHaveLength(0);
    expect(result.bounds.w).toBe(0);
  });

  it('handles newline characters', () => {
    const result = textToOutlines('A\nB', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(result.glyphs).toHaveLength(2);
  });

  it('respects letterSpacing', () => {
    const noSpacing = textToOutlines('AB', {
      fontSize: 16,
      fontFamily: 'Inter',
      letterSpacing: 0,
    });
    const withSpacing = textToOutlines('AB', {
      fontSize: 16,
      fontFamily: 'Inter',
      letterSpacing: 10,
    });
    expect(withSpacing.bounds.w).toBeGreaterThan(noSpacing.bounds.w);
  });
});

describe('textToOutlines — opentype.js path (with fontData)', () => {
  it('produces real glyph outlines with bezier handles', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('O', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    expect(result.isPlaceholder).toBe(false);
    expect(result.glyphs).toHaveLength(1);
    const glyph = result.glyphs[0]!;
    expect(glyph.char).toBe('O');
    expect(glyph.points.length).toBeGreaterThan(4);
    expect(glyph.advance).toBeGreaterThan(0);

    const hasHandles = glyph.points.some((p) => p.handleIn !== null || p.handleOut !== null);
    expect(hasHandles).toBe(true);
  });

  it('positions multiple glyphs with correct advance', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('AB', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    expect(result.glyphs).toHaveLength(2);
    const aGlyph = result.glyphs[0]!;
    const bGlyph = result.glyphs[1]!;
    expect(aGlyph.advance).toBeGreaterThan(0);
    expect(bGlyph.advance).toBeGreaterThan(0);
    expect(bGlyph.bounds.x).toBeGreaterThan(aGlyph.bounds.x);
    const spacing = bGlyph.bounds.x - aGlyph.advance;
    expect(Math.abs(spacing)).toBeLessThan(aGlyph.advance * 0.5);
  });

  it('scales outlines to match fontSize', async () => {
    const fontData = await loadFontData();
    const small = textToOutlines('A', {
      fontSize: 50,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    const large = textToOutlines('A', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    const smallGlyph = small.glyphs[0]!;
    const largeGlyph = large.glyphs[0]!;
    expect(largeGlyph.bounds.w).toBeGreaterThan(0);
    expect(smallGlyph.bounds.w).toBeGreaterThan(0);
    const ratio = largeGlyph.bounds.w / smallGlyph.bounds.w;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  it('produces valid SVG path with C commands for bezier curves', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('O', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    const svgPath = glyphOutlineToSvgPath(result.glyphs[0]!);
    expect(svgPath).toMatch(/^M /);
    expect(svgPath).toMatch(/ Z$/);
    expect(svgPath).toContain(' C ');
  });

  it('handles space characters correctly', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('A B', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    expect(result.glyphs).toHaveLength(3);
    const spaceGlyph = result.glyphs[1]!;
    expect(spaceGlyph.char).toBe(' ');
    expect(spaceGlyph.advance).toBeGreaterThan(0);
    expect(spaceGlyph.points).toHaveLength(0);
  });

  it('handles empty text gracefully', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    expect(result.glyphs).toHaveLength(0);
  });
});

describe('textToOutlines — compound paths (rings)', () => {
  it('produces rings for glyphs with counters', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('O', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    const glyph = result.glyphs[0]!;
    expect(glyph.rings.length).toBeGreaterThan(0);
    // 'O' has an outer contour and at least one hole (counter)
    expect(glyph.rings.length).toBeGreaterThanOrEqual(2);
    // Outer ring is always first
    const outer = glyph.rings[0]!;
    expect(outer.length).toBeGreaterThan(0);
    // points should equal flattened rings
    expect(glyph.points.length).toBe(glyph.rings.reduce((s, r) => s + r.length, 0));
  });

  it('produces a single ring for glyphs without counters', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('I', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    const glyph = result.glyphs[0]!;
    expect(glyph.rings.length).toBeGreaterThanOrEqual(1);
    expect(glyph.rings.length).toBeLessThanOrEqual(2);
  });

  it('returns empty rings for space glyphs', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines(' ', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
      x: 0,
      y: 0,
    });
    const glyph = result.glyphs[0]!;
    expect(glyph.rings.length).toBe(0);
    expect(glyph.points.length).toBe(0);
  });
});

describe('textToOutlines — warnings and metadata', () => {
  it('reports bitmap-only and restricted base flags independently', async () => {
    const fontData = withEmbeddingFlags(await loadFontData(), 0x0302, 4);
    const result = textToOutlines('A', { fontSize: 16, fontFamily: 'Geist', fontData });
    expect(result.restrictedEmbedding).toBe(true);
    expect(result.warnings).toContain(
      'Font metadata has bitmap-only embedding set. Check the source license before outlining.',
    );
    expect(result.warnings).toContain(
      'Font metadata declares restricted embedding. Check the source license before outlining.',
    );
  });

  it.each([0x000e, 0x0001, 0x0040])(
    'reports malformed modern fsType=%i as unknown',
    async (flags) => {
      const fontData = withEmbeddingFlags(await loadFontData(), flags, 4);
      const result = textToOutlines('A', { fontSize: 16, fontFamily: 'Geist', fontData });
      expect(result.warnings).toContain(
        'Font embedding permissions could not be determined. Check the source license before outlining.',
      );
    },
  );

  it.each([
    [4, 0x0002, true],
    [4, 0x0102, true],
    [4, 0x0004, true],
    [4, 0x0108, false],
    [4, 0x0208, true],
    [0, 0x0208, false],
    [1, 0x0208, false],
    [2, 0x000e, false],
  ] as const)(
    'reads OS/2 v%i fsType=%i without losing base restrictions',
    async (version, flags, restricted) => {
      const fontData = withEmbeddingFlags(await loadFontData(), flags, version);
      const result = textToOutlines('A', { fontSize: 16, fontFamily: 'Geist', fontData });
      expect(result.isPlaceholder).toBe(false);
      expect(result.restrictedEmbedding).toBe(restricted);
      expect(result.warnings.length > 0).toBe(restricted);
    },
  );

  it('returns warnings array for placeholder outlines', () => {
    const result = textToOutlines('A', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.hasColorGlyphs).toBe(false);
    expect(result.restrictedEmbedding).toBe(false);
  });

  it('returns warnings array for real outlines', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('A', {
      fontSize: 100,
      fontFamily: 'Geist',
      fontData,
    });
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.isPlaceholder).toBe(false);
  });
});

describe('glyphOutlineToSvgPath', () => {
  it('produces a valid SVG path string', () => {
    const result = textToOutlines('A', {
      fontSize: 16,
      fontFamily: 'Inter',
      x: 10,
      y: 20,
    });
    const path = glyphOutlineToSvgPath(result.glyphs[0]!);
    expect(path).toMatch(/^M /);
    expect(path).toMatch(/ Z$/);
    expect(path).toContain(' L ');
  });

  it('returns empty string for zero points', async () => {
    const fontData = await loadFontData();
    const result = textToOutlines('A', { fontSize: 16, fontFamily: 'Geist', fontData });
    const glyph = result.glyphs[0]!;
    const emptyGlyph = { ...glyph, points: [] };
    expect(glyphOutlineToSvgPath(emptyGlyph)).toBe('');
  });
});

describe('textOutlinesToSvg', () => {
  it('produces an SVG group element', () => {
    const result = textToOutlines('Hi', {
      fontSize: 16,
      fontFamily: 'Inter',
    });
    const svg = textOutlinesToSvg(result, '#ff0000');
    expect(svg).toContain('<g>');
    expect(svg).toContain('</g>');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('<path');
  });
});
