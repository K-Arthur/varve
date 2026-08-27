/**
 * Fill UX visual evidence capture.
 * Produces a deterministic screenshot set for the non-solid fill fix:
 *  fill-visuals/01-solid-before.png     — solid teal rect
 *  fill-visuals/02-gradient-after.png   — one-click Add fill → Linear gradient
 *  fill-visuals/03-image-empty.png      — empty image fill + empty state UI
 *  fill-visuals/04-image-after.png      — chosen image inside the shape
 *  fill-visuals/05-pattern-after.png    — repeated checker tile
 *  fill-visuals/06-grad-editor.png      — GradientEditor with stops
 */
import { test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { navigateToCleanEditor } from '../helpers/nav';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ (data[i] ?? 0)) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
const IMAGE_PNG = png(32, 24, (x) => (x < 16 ? [200, 30, 30, 255] : [30, 60, 200, 255]));
const TILE_PNG = png(8, 8, (x, y) => {
  const black = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
  return black ? [20, 20, 20, 255] : [235, 235, 235, 255];
});

async function createRect(page: Page): Promise<void> {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 350);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.waitForTimeout(400);
}

test('fill visual evidence set', async ({ page }) => {
  test.setTimeout(240000);
  await navigateToCleanEditor(page);
  await createRect(page);
  await page.screenshot({ path: 'test-results/fill-visuals/01-solid-before.png' });

  // Add fill → Linear gradient
  await page.getByRole('button', { name: /add fill/i }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('menuitem', { name: 'Linear gradient' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/fill-visuals/02-gradient-after.png' });

  // Scroll the gradient editor into view for a close-up of stops
  const editor = page.locator('.gradient-editor');
  await editor.waitFor({ state: 'visible', timeout: 5000 });
  await editor.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/fill-visuals/06-grad-editor.png' });

  // Undo the added gradient; convert the existing fill to Image (empty)
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  await page.getByRole('combobox', { name: /fill type/i }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('option', { name: /^Image$/i }).click();
  await page.waitForTimeout(800);
  await page.locator('.insp-image-fill__empty-hint').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/fill-visuals/03-image-empty.png' });

  // Choose image
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose image/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'fill-fixture.png', mimeType: 'image/png', buffer: IMAGE_PNG });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/fill-visuals/04-image-after.png' });

  // Convert to Pattern and choose a tile
  await page.getByRole('combobox', { name: /fill type/i }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('option', { name: /^Pattern$/i }).click();
  await page.waitForTimeout(700);
  const tileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose tile/i }).click();
  const tileChooser = await tileChooserPromise;
  await tileChooser.setFiles({
    name: 'tile-fixture.png',
    mimeType: 'image/png',
    buffer: TILE_PNG,
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'test-results/fill-visuals/05-pattern-after.png' });
});
