/**
 * Parses the variable fonts the desktop app actually bundles.
 *
 * The synthetic fixtures in `fontParser.test.ts` are built by this repo, so
 * for a long time they agreed with a parser that read `fvar` at the wrong
 * header offsets and decoded its `Fixed` 16.16 bounds as IEEE floats: the
 * encoder made the same two mistakes as the decoder, and the round-trip
 * passed. Only a font this repo did not author can catch that class of bug,
 * so these cases read checked-in, unmodified `@fontsource-variable` payloads and assert
 * axis values that are documented properties of those typefaces.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFontCollection, parseFontData } from './fontParser';

/** Required unmodified Fontsource bytes, checked in with their OFL licenses. */
function fontFile(pkg: string, file: string): Buffer {
  return readFileSync(new URL(`./__fixtures__/${pkg}/${file}`, import.meta.url));
}

async function axesOf(pkg: string, file: string) {
  const woff2 = fontFile(pkg, file);
  // The parser takes raw OpenType tables; woff2 is a compressed container.
  const { decompress } = await import('wawoff2');
  const ttf = await decompress(woff2);
  const buffer = ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;
  const meta = await parseFontData(buffer);
  return meta.axes;
}

describe('parsing against required real bundled variable fonts', () => {
  it('reads Geist Variable as a single wght axis spanning 100-900', async () => {
    const axes = await axesOf('geist', 'geist-latin-wght-normal.woff2');
    expect(axes).toHaveLength(1);
    expect(axes[0]).toMatchObject({ tag: 'wght', min: 100, default: 400, max: 900 });
  });

  it('reads both Fraunces axes, the two the editor exposes for it', async () => {
    const axes = await axesOf('fraunces', 'fraunces-latin-opsz-normal.woff2');
    const byTag = Object.fromEntries(axes.map((a) => [a.tag, a]));
    expect(Object.keys(byTag).sort()).toEqual(['opsz', 'wght']);
    expect(byTag.opsz).toMatchObject({ min: 9, max: 144 });
    expect(byTag.wght).toMatchObject({ min: 100, max: 900 });
  });

  it('reads IBM Plex Sans Variable, whose wght tops out at 700 rather than 900', async () => {
    const axes = await axesOf('ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2');
    const wght = axes.find((a) => a.tag === 'wght');
    // A generic "wght is 1-1000" assumption would sail past this.
    expect(wght).toMatchObject({ min: 100, default: 400, max: 700 });
  });

  it('decodes named instances as real coordinates, not denormals', async () => {
    const woff2 = fontFile('geist', 'geist-latin-wght-normal.woff2');
    const { decompress } = await import('wawoff2');
    const ttf = await decompress(woff2);
    const buffer = ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;
    const meta = await parseFontData(buffer);
    expect(meta.namedInstances.length).toBeGreaterThan(0);
    const weights = meta.namedInstances.map((i) => i.coordinates.wght ?? 0);
    // Geist ships Thin..Black; every coordinate must land inside the axis range.
    expect(Math.min(...weights)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...weights)).toBeLessThanOrEqual(900);
    expect(weights).toContain(400);
  });
});

// The source packages include their OFL licenses; expected values were checked
// independently with opentype.js and the OS/2 field layout, not our encoder.
describe('OS/2 metrics from licensed bundled font artifacts', () => {
  it.each([
    ['geist', 'geist-latin-wght-normal.woff2', 530, 710],
    ['ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2', 516, 698],
    ['fraunces', 'fraunces-latin-opsz-normal.woff2', 964, 1400],
  ] as const)(
    'reads %s x-height and cap-height in font units',
    async (pkg, file, xHeight, capHeight) => {
      const woff2 = fontFile(pkg, file);
      const meta = await parseFontData(
        woff2.buffer.slice(woff2.byteOffset, woff2.byteOffset + woff2.byteLength) as ArrayBuffer,
      );
      expect(meta.xHeight).toBe(xHeight);
      expect(meta.capHeight).toBe(capHeight);
      expect(meta.format).toBe('woff2');
      expect(meta.identity.hashAlgorithm).toBe('sha256');
      expect(meta.identity.contentHash).toBe(createHash('sha256').update(woff2).digest('hex'));
      expect(meta.fileSize).toBe(woff2.byteLength);
    },
  );
});

describe('original artifact identity across parser entry points', () => {
  it.each([
    ['geist', 'geist-latin-wght-normal.woff2'],
    ['ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2'],
    ['fraunces', 'fraunces-latin-opsz-normal.woff2'],
  ] as const)('preserves %s WOFF2 metadata through collection enumeration', async (pkg, file) => {
    const bytes = fontFile(pkg, file);
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const face = await parseFontData(data);
    const members = await parseFontCollection(data);
    expect(members).toEqual([face]);
  });
});
