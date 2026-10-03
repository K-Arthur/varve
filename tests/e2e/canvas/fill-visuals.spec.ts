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

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { selectFillType } from '../helpers/editor-helpers';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToCleanEditor } from '../helpers/nav';
import { resizePanelToWidth } from '../helpers/panel-resize';
import { readEditorState } from '../helpers/tabletControls';
import { navigateToEditor } from '../shared';

const PHOTO_FIXTURE = path.resolve('tests/e2e/fixtures/photo-fixture.jpg');

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
function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Buffer {
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

async function createRect(page: Page): Promise<{ x: number; y: number }> {
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
  return { x: box.x + 300, y: box.y + 250 };
}

async function patternPixelSample(page: Page, point: { x: number; y: number }) {
  return page.evaluate((point) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('Content canvas is unavailable');
    const bounds = canvas.getBoundingClientRect();
    const scale = canvas.width / bounds.width;
    const centerX = Math.round((point.x - bounds.x) * scale);
    const centerY = Math.round((point.y - bounds.y) * (canvas.height / bounds.height));
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 2166136261;
    for (const value of image.data) hash = Math.imul(hash ^ value, 16777619);
    let dark = 0;
    let light = 0;
    for (let y = centerY - 24; y < centerY + 24; y++) {
      for (let x = centerX - 24; x < centerX + 24; x++) {
        const offset = (y * canvas.width + x) * 4;
        const [r, g, b, a] = image.data.subarray(offset, offset + 4);
        if (r === 20 && g === 20 && b === 20 && a === 255) dark++;
        if (r === 235 && g === 235 && b === 235 && a === 255) light++;
      }
    }
    const perf = (
      window as unknown as {
        __varvePerf?: { getLast: () => { camera: unknown; docVersion: number } | null };
      }
    ).__varvePerf;
    return {
      hash: `${image.data.length}:${hash >>> 0}`,
      width: canvas.width,
      height: canvas.height,
      dark,
      light,
      frame: perf?.getLast() ?? null,
    };
  }, point);
}

async function assertPatternPixelsAndFullRedraw(page: Page, point: { x: number; y: number }) {
  // UI readiness proves the preview decoded; the canvas must independently
  // paint both authored colours, rather than pass with the grey fallback.
  await expect.poll(async () => (await patternPixelSample(page, point)).dark).toBeGreaterThan(500);
  await expect.poll(async () => (await patternPixelSample(page, point)).light).toBeGreaterThan(500);
  const before = await patternPixelSample(page, point);
  const receipt = await page.evaluate(() => {
    const perf = (
      window as unknown as {
        __varvePerf?: { forceFullRedraw: () => Promise<{ authoritative: boolean }> };
      }
    ).__varvePerf;
    if (!perf) throw new Error('Full-redraw oracle is unavailable');
    return perf.forceFullRedraw();
  });
  const after = await patternPixelSample(page, point);
  const oracle = JSON.stringify({ before, after, receipt }, null, 2);
  await writeFile(evidencePath('fill-visuals/checker-pattern-full-redraw-oracle.json'), oracle);
  await test.info().attach('checker-pattern-full-redraw-oracle.json', {
    body: oracle,
    contentType: 'application/json',
  });
  expect(receipt.authoritative).toBe(true);
  expect(before.frame?.camera).toBeDefined();
  expect(after.frame?.camera).toEqual(before.frame?.camera);
  expect(after.frame?.docVersion).toBe(before.frame?.docVersion);
  expect({ width: after.width, height: after.height }).toEqual({
    width: before.width,
    height: before.height,
  });
  expect(after.hash).toBe(before.hash);
  expect(after.dark).toBeGreaterThan(500);
  expect(after.light).toBeGreaterThan(500);
}

test('fill visual evidence set', async ({ page }) => {
  test.setTimeout(240000);
  const duplicateAuditRuleWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().startsWith('[audit] Overwriting rule:')) {
      duplicateAuditRuleWarnings.push(message.text());
    }
  });
  await navigateToEditor(page, '/?perf=1');
  const point = await createRect(page);
  await page.screenshot({ path: evidencePath('fill-visuals/01-solid-before.png') });

  // Add fill → Linear gradient
  await page
    .getByRole('button', { name: /add fill/i })
    .first()
    .click();
  await page.waitForTimeout(250);
  await page.getByRole('menuitem', { name: 'Linear gradient' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: evidencePath('fill-visuals/02-gradient-after.png') });

  // Gradient controls live in the paint's colour-picker popover; adding the
  // fill preserves the inspector row without automatically opening a dialog.
  await page.getByRole('button', { name: 'Fill 2 gradient', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Pick Fill 2 gradient', exact: true });
  await expect(picker).toBeVisible();
  // Scroll the gradient editor into view for a close-up of stops
  const editor = page.locator('.gradient-editor');
  await editor.waitFor({ state: 'visible', timeout: 5000 });
  await editor.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: evidencePath('fill-visuals/06-grad-editor.png') });
  await picker.getByRole('button', { name: 'Dismiss colour picker' }).click();
  await expect(picker).toHaveCount(0);

  // Undo the added gradient; convert the existing fill to Image (empty)
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  await selectFillType(page, 'Image');
  await page.waitForTimeout(800);
  await page.locator('.insp-image-fill__empty-hint').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: evidencePath('fill-visuals/03-image-empty.png') });

  // Choose image
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose image/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'fill-fixture.png', mimeType: 'image/png', buffer: IMAGE_PNG });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: evidencePath('fill-visuals/04-image-after.png') });
  const imageDocument = JSON.parse((await readEditorState(page)).serialized) as {
    assets?: Record<string, unknown>;
  };
  expect(Object.keys(imageDocument.assets ?? {}).length).toBeGreaterThan(0);

  // Convert to Pattern and choose a tile
  await selectFillType(page, 'Pattern');
  await page.waitForTimeout(700);
  const tileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose tile/i }).click();
  const tileChooser = await tileChooserPromise;
  await tileChooser.setFiles({
    name: 'tile-fixture.png',
    mimeType: 'image/png',
    buffer: TILE_PNG,
  });
  await expect(page.getByText('Imported tile', { exact: true })).toBeVisible();
  const persisted = JSON.parse((await readEditorState(page)).serialized) as {
    nodes: Record<string, { fills?: Array<{ type: string; pattern?: { tileSrc: string } }> }>;
  };
  const pattern = Object.values(persisted.nodes)
    .flatMap((node) => node.fills ?? [])
    .find((fill) => fill.type === 'pattern');
  expect(pattern?.pattern?.tileSrc).toBe(`data:image/png;base64,${TILE_PNG.toString('base64')}`);
  await assertPatternPixelsAndFullRedraw(page, point);
  await page.screenshot({ path: evidencePath('fill-visuals/05-pattern-after.png') });
  expect(duplicateAuditRuleWarnings).toEqual([]);
});

test('image colour metadata stays separated in a narrow inspector', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await navigateToCleanEditor(page);
  await page.locator('#file-import-input').setInputFiles(PHOTO_FIXTURE);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  await page.getByRole('treeitem').first().click();
  await expect(page.locator('.insp-image-fill__preview-img')).toBeVisible({ timeout: 15000 });

  const fillTrigger = page.getByRole('button', { name: 'Fill', exact: true });
  if ((await fillTrigger.getAttribute('aria-expanded')) !== 'true') await fillTrigger.click();
  await expect(page.locator('.insp-image-fill__preview-img')).toBeVisible({ timeout: 15000 });

  const detailsButton = page.getByRole('button', { name: /show colour details/i });
  await expect(detailsButton).toBeVisible({ timeout: 15000 });
  await detailsButton.click();

  // Exercise the smallest supported desktop inspector width. The editor shell
  // remains wide enough for the canvas, while the right panel gets the tight
  // layout that exposed the original metadata overlap.
  await resizePanelToWidth(page, 'inspector', 280);
  const inspector = page.locator('.editor__inspector-panel');
  await page.waitForTimeout(100);

  const detailRows = inspector.locator('.insp-image-fill__color-detail');
  const geometry = await detailRows.evaluateAll((rows) =>
    rows.map((row) => {
      const label = row.querySelector('dt')?.getBoundingClientRect();
      const value = row.querySelector('dd')?.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        row: { top: rowBox.top, bottom: rowBox.bottom },
        label: label ? { right: label.right, bottom: label.bottom } : null,
        value: value ? { left: value.left, top: value.top } : null,
      };
    }),
  );

  expect(geometry.length).toBeGreaterThanOrEqual(4);
  for (const row of geometry) {
    expect(row.label).not.toBeNull();
    expect(row.value).not.toBeNull();
    expect(row.value!.left).toBeGreaterThanOrEqual(row.label!.right - 1);
    expect(row.value!.top).toBeGreaterThanOrEqual(row.row.top - 1);
    expect(row.value!.top).toBeLessThanOrEqual(row.row.bottom);
  }
  for (let index = 1; index < geometry.length; index += 1) {
    expect(geometry[index]!.row.top).toBeGreaterThanOrEqual(geometry[index - 1]!.row.bottom - 1);
  }

  const panelShot = await inspector.screenshot();
  await testInfo.attach('narrow-image-colour-metadata', {
    body: panelShot,
    contentType: 'image/png',
  });
  await inspector.screenshot({
    path: evidencePath('fill-visuals/narrow-image-colour-metadata.png'),
  });
});
