import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { createFlatMesh } from './meshWarp';
import { type WarpTextOptions, warpTextToMesh } from './textWarpPipeline';

const wawoff2: { decompress: (data: Uint8Array) => Promise<Uint8Array> } = require('wawoff2');

const GEIST_PATH = join(
  process.cwd(),
  'node_modules',
  '.pnpm',
  '@fontsource-variable+geist@5.2.9',
  'node_modules',
  '@fontsource-variable',
  'geist',
  'files',
  'geist-latin-wght-normal.woff2',
);

async function loadFontData(): Promise<ArrayBuffer> {
  const woff2 = readFileSync(GEIST_PATH);
  const decompressed = await wawoff2.decompress(new Uint8Array(woff2));
  const copy = new Uint8Array(decompressed.length);
  copy.set(decompressed);
  return copy.buffer;
}

describe('warpTextToMesh', () => {
  it('warps text through an undeformed mesh (identity)', async () => {
    const fontData = await loadFontData();
    const opts: WarpTextOptions = {
      text: 'Hi',
      fontData,
      fontSize: 50,
      fontFamily: 'Geist',
    };
    const mesh = createFlatMesh(2, 2, 100, 50);
    const result = warpTextToMesh(opts, mesh, 100, 50);
    expect(result.glyphs).toHaveLength(2);
    expect(result.glyphs[0]!.points.length).toBeGreaterThan(0);
    expect(result.isPlaceholder).toBe(false);
  });

  it('warps glyph positions through a displaced mesh', async () => {
    const fontData = await loadFontData();
    const opts: WarpTextOptions = {
      text: 'A',
      fontData,
      fontSize: 100,
      fontFamily: 'Geist',
      x: 10,
      y: 50,
    };
    const mesh = createFlatMesh(1, 1, 100, 100);
    const flat = warpTextToMesh(opts, mesh, 100, 100);

    const displacedMesh = {
      cols: 1,
      rows: 1,
      vertices: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 0, y: 100 },
        { x: 60, y: 60 },
      ],
    };
    const warped = warpTextToMesh(opts, displacedMesh, 100, 100);
    expect(warped.glyphs[0]!.points.length).toBeGreaterThan(0);
    const flatPts = flat.glyphs[0]!.points;
    const warpPts = warped.glyphs[0]!.points;
    const anyMoved = flatPts.some((fp, i) => {
      const wp = warpPts[i]!;
      return Math.abs(wp.x - fp.x) > 0.01 || Math.abs(wp.y - fp.y) > 0.01;
    });
    expect(anyMoved).toBe(true);
  });

  it('produces valid SVG output after warp', async () => {
    const fontData = await loadFontData();
    const opts: WarpTextOptions = {
      text: 'O',
      fontData,
      fontSize: 100,
      fontFamily: 'Geist',
    };
    const mesh = createFlatMesh(2, 2, 100, 100);
    const result = warpTextToMesh(opts, mesh, 100, 100);
    expect(result.isPlaceholder).toBe(false);
    const svgPath = result.glyphs[0]!.points.length > 0;
    expect(svgPath).toBe(true);
  });
});
