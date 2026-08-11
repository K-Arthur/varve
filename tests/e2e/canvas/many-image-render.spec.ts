/**
 * Many-image canvas rendering regression.
 *
 * A document carrying more distinct image sources than the worker's transfer
 * budget (`MemoryBudgets.workerImageBitmaps`) used to render only the images
 * that existed when the last accepted worker frame was produced: the async
 * `collectImageBitmaps` refusal landed after the frame had already composited
 * the cached worker bitmap, and since no fresh frame was ever posted the
 * surface stayed pinned to that stale bitmap. Fit-all showed one image out of
 * thirteen and panning smeared the old frame instead of repainting.
 *
 * The guard is a coverage comparison across the budget boundary: a document
 * just over the budget must paint at least as much distinct content as one
 * just under it. Sampling pixels (rather than asserting an exact image) keeps
 * this robust against renderer/AA differences while still failing hard on the
 * "stale bitmap, images missing" regression, which collapses coverage by ~50x.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };
/** Comfortably above the default `workerImageBitmaps` budget of 10. */
const OVER_BUDGET_COUNT = 12;
const IMG_W = 900;
const IMG_H = 700;

// ── Minimal PNG writer (no image deps): raw scanlines + zlib + chunk framing ──

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Distinct per-index hue plus internal banding, so each image is separable. */
function makePng(width: number, height: number, seed: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const band = ((x / 48) | 0) + ((y / 48) | 0);
      const t = (x / width) * 255;
      raw[p++] = (seed * 37 + t) % 256;
      raw[p++] = (band % 2 === 0 ? 220 : 40 + seed * 11) % 256;
      raw[p++] = (255 - t + seed * 23) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeFixtures(count: number): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'varve-many-image-'));
  return Array.from({ length: count }, (_, i) => {
    const file = path.join(dir, `img-${String(i).padStart(2, '0')}.png`);
    writeFileSync(file, makePng(IMG_W, IMG_H, i));
    return file;
  });
}

/** Fraction of sampled canvas pixels differing from the board colour. */
async function paintedCoverage(
  page: import('@playwright/test').Page,
): Promise<{ coverage: number; distinctColours: number }> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('canvas 2d context unavailable');
    const data = context.getImageData(0, 0, surface.width, surface.height).data;
    const bg = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    let painted = 0;
    let total = 0;
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 8) {
      total++;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const diff =
        Math.abs(r - (bg[0] ?? 0)) + Math.abs(g - (bg[1] ?? 0)) + Math.abs(b - (bg[2] ?? 0));
      if (diff > 24) {
        painted++;
        colours.add((r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3));
      }
    }
    return { coverage: total > 0 ? painted / total : 0, distinctColours: colours.size };
  });
}

/** Import `files` one at a time, parking each in a grid slot via the Inspector. */
async function importSpreadImages(
  page: import('@playwright/test').Page,
  files: readonly string[],
): Promise<void> {
  const position = page.getByRole('group', { name: 'Position & Size' });
  const xField = position.getByLabel('X (px)');
  const yField = position.getByLabel('Y (px)');
  for (const [index, file] of files.entries()) {
    await page.locator('#file-import-input').setInputFiles(file);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(200);
    await xField.fill(String((index % 4) * 1600));
    await xField.press('Enter');
    await yField.fill(String(Math.floor(index / 4) * 1200));
    await yField.press('Enter');
    await page.waitForTimeout(100);
  }
}

test.describe('many-image canvas rendering', () => {
  test.describe.configure({ timeout: 600_000 });

  test('paints every image after fit-all when the document exceeds the worker transfer budget', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);

    await importSpreadImages(page, writeFixtures(OVER_BUDGET_COUNT));

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(2000);

    const painted = await paintedCoverage(page);

    // The stale-bitmap regression collapses this to ~0.004 / ~30 colours:
    // one image out of twelve, frozen from the last accepted worker frame.
    expect(
      painted.coverage,
      'fit-all must paint the whole scene, not a stale worker bitmap',
    ).toBeGreaterThan(0.1);
    // Each fixture carries a distinct hue ramp, so a scene that really painted
    // twelve of them cannot collapse to a handful of colours.
    expect(
      painted.distinctColours,
      'every imported image should contribute its own colours',
    ).toBeGreaterThan(500);
  });
});
