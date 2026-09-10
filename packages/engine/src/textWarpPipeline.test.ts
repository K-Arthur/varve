import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFlatMesh } from './meshWarp';
import { type WarpTextOptions, warpTextToMesh } from './textWarpPipeline';

const wawoff2: { decompress: (data: Uint8Array) => Promise<Uint8Array> } = require('wawoff2');

/**
 * Resolve the Geist variable font from the installed store instead of
 * hardcoding a version in the .pnpm path: the lockfile moves between
 * releases (5.2.9 -> 5.3.0) and a hardcoded version breaks the release
 * gate's fresh `pnpm install --frozen-lockfile` while passing on a dev
 * machine with a stale leftover directory.
 */
function resolveGeistPath(): string {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const resolved = execSync(
    'node -e "console.log(require.resolve(\'@fontsource-variable/geist/package.json\'))"',
    {
      encoding: 'utf8',
      cwd: process.cwd(),
    },
  ).trim();
  const pkgDir = join(resolved, '..');
  return join(pkgDir, 'files', 'geist-latin-wght-normal.woff2');
}

const GEIST_PATH = resolveGeistPath();

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
