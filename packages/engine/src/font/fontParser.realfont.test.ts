/**
 * Parses the variable fonts the desktop app actually bundles.
 *
 * The synthetic fixtures in `fontParser.test.ts` are built by this repo, so
 * for a long time they agreed with a parser that read `fvar` at the wrong
 * header offsets and decoded its `Fixed` 16.16 bounds as IEEE floats: the
 * encoder made the same two mistakes as the decoder, and the round-trip
 * passed. Only a font this repo did not author can catch that class of bug,
 * so these cases read the real `@fontsource-variable` payloads and assert
 * axis values that are documented properties of those typefaces.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseFontData } from './fontParser';

const require = createRequire(import.meta.url);

/** Resolves a bundled font payload through the desktop app's dependency. */
function fontFile(pkg: string, file: string): Buffer | null {
  try {
    const metadata = require.resolve(`@fontsource-variable/${pkg}/metadata.json`, {
      paths: [new URL('../../../../apps/desktop', import.meta.url).pathname],
    });
    return readFileSync(metadata.replace(/metadata\.json$/, `files/${file}`));
  } catch {
    return null;
  }
}

async function axesOf(pkg: string, file: string) {
  const woff2 = fontFile(pkg, file);
  if (!woff2) return null;
  // The parser takes raw OpenType tables; woff2 is a compressed container.
  const { decompress } = await import('wawoff2');
  const ttf = await decompress(woff2);
  const buffer = ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;
  const meta = await parseFontData(buffer);
  return meta.axes;
}

describe('fvar parsing against real bundled variable fonts', () => {
  it('reads Geist Variable as a single wght axis spanning 100-900', async () => {
    const axes = await axesOf('geist', 'geist-latin-wght-normal.woff2');
    if (!axes) return; // dependency not installed in this checkout
    expect(axes).toHaveLength(1);
    expect(axes[0]).toMatchObject({ tag: 'wght', min: 100, default: 400, max: 900 });
  });

  it('reads both Fraunces axes, the two the editor exposes for it', async () => {
    const axes = await axesOf('fraunces', 'fraunces-latin-opsz-normal.woff2');
    if (!axes) return;
    const byTag = Object.fromEntries(axes.map((a) => [a.tag, a]));
    expect(Object.keys(byTag).sort()).toEqual(['opsz', 'wght']);
    expect(byTag.opsz).toMatchObject({ min: 9, max: 144 });
    expect(byTag.wght).toMatchObject({ min: 100, max: 900 });
  });

  it('reads IBM Plex Sans Variable, whose wght tops out at 700 rather than 900', async () => {
    const axes = await axesOf('ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2');
    if (!axes) return;
    const wght = axes.find((a) => a.tag === 'wght');
    // A generic "wght is 1-1000" assumption would sail past this.
    expect(wght).toMatchObject({ min: 100, default: 400, max: 700 });
  });

  it('decodes named instances as real coordinates, not denormals', async () => {
    const woff2 = fontFile('geist', 'geist-latin-wght-normal.woff2');
    if (!woff2) return;
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
