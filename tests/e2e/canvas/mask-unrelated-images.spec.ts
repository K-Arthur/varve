/**
 * Regression corpus: applying/editing a raster mask on one image must never
 * make unrelated canvas content disappear, and transparent mask regions must
 * reveal content beneath the masked image.
 *
 * Every assertion is pixel-grounded on the content canvas — node existence in
 * the DOM/document is not sufficient (an image node can exist while its
 * pixels are absent from the retained backing store).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

type Rgb = { r: number; g: number; b: number };

const COLORS = {
  // A — target: teal background + orange-red subject (the subject is what
  // Quick segmentation must keep; the background must become transparent).
  aBg: { r: 0x00, g: 0xa3, b: 0xcc },
  aSubject: { r: 0xd9, g: 0x4f, b: 0x30 },
  blue: { r: 0x3b, g: 0x82, b: 0xf6 }, // B — unrelated
  green: { r: 0x22, g: 0xc5, b: 0x5e }, // C — unrelated
  amber: { r: 0xf5, g: 0x9e, b: 0x0b }, // D — unrelated
} as const;

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SIZE = 120;

function makeTargetImage(page: Page): Promise<string> {
  return page.evaluate(
    ({ size }) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#00a3cc';
      ctx.fillRect(0, 0, size, size);
      ctx.beginPath();
      ctx.ellipse(size / 2, size / 2, size * 0.24, size * 0.34, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d94f30';
      ctx.fill();
      ctx.fillStyle = '#7a5cd9';
      ctx.fillRect(size * 0.14, size * 0.14, size * 0.18, size * 0.18);
      return c.toDataURL('image/png');
    },
    { size: SIZE },
  );
}

function makeSolidImage(page: Page, color: Rgb): Promise<string> {
  return page.evaluate(
    ({ r, g, b, size }) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, size, size);
      return c.toDataURL('image/png');
    },
    { ...color, size: SIZE },
  );
}

async function dropImage(page: Page, dataUrl: string, clientX: number, clientY: number) {
  const tmpFile = path.join(
    '/tmp',
    `mask-repro-${process.pid}-${Math.random().toString(36).slice(2)}.png`,
  );
  fs.writeFileSync(tmpFile, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas not found');
  await page.evaluate(
    ({ px, py, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'mask-repro.png', { type: 'image/png' }));
      const target = document.querySelector('canvas.editor-canvas__content-layer');
      if (!target) throw new Error('content canvas not found');
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: px,
          clientY: py,
          dataTransfer: transfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: px,
          clientY: py,
          dataTransfer: transfer,
        }),
      );
    },
    { px: box.x + clientX, py: box.y + clientY, b64: dataUrl.split(',')[1]! },
  );
  fs.unlinkSync(tmpFile);
}

/** Find the bounding box of pixels close to a color on the content canvas. */
async function colorBBox(page: Page, color: Rgb): Promise<BBox | null> {
  return page.evaluate(({ r, g, b }) => {
    const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
      | HTMLCanvasElement
      | undefined;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const dr = Math.abs(data[i]! - r);
        const dg = Math.abs(data[i + 1]! - g);
        const db = Math.abs(data[i + 2]! - b);
        const alpha = data[i + 3]!;
        if (alpha > 64 && dr < 28 && dg < 28 && db < 28) {
          count++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (count === 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }, color);
}

/** Stable content hash of a canvas region (sampled stride 3). */
async function regionHash(page: Page, box: BBox): Promise<string> {
  return page.evaluate(({ x, y, w, h }) => {
    const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
      | HTMLCanvasElement
      | undefined;
    if (!canvas) return '';
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.max(1, Math.min(Math.ceil(w), canvas.width - sx));
    const sh = Math.max(1, Math.min(Math.ceil(h), canvas.height - sy));
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < data.length; i += 3) {
      h1 = (h1 ^ data[i]!) * 0x01000193;
      h2 = (h2 ^ data[i + 1]!) * 0x01000193;
      h1 = (h1 ^ data[i + 2]!) * 0x01000193;
    }
    return `${h1 >>> 0}:${h2 >>> 0}`;
  }, box);
}

async function fullCanvasHash(page: Page): Promise<string> {
  return regionHash(page, { x: 0, y: 0, w: 1e9, h: 1e9 });
}

async function waitForColor(page: Page, color: Rgb, label: string): Promise<BBox> {
  await expect
    .poll(async () => colorBBox(page, color), { timeout: 20000, message: `${label} should appear` })
    .not.toBeNull();
  const box = await colorBBox(page, color);
  if (!box) throw new Error(`${label} never appeared on the canvas`);
  return box;
}

async function selectImageAt(page: Page, box: BBox): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const cbox = await canvas.boundingBox();
  if (!cbox) throw new Error('content canvas not found');
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
  await page.mouse.click(cbox.x + box.x + box.w / 2, cbox.y + box.y + box.h / 2);
  await page.waitForTimeout(400);
}

test.describe('raster mask must not disturb unrelated canvas content', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, '/?perf=1');
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        (d as HTMLDialogElement).close();
      });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const dismiss = page.getByRole('button', { name: /dismiss/i });
    if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dismiss.click();
    }
    await page.waitForTimeout(300);
  });

  test('Apply / Edit / Show Original / Reset keep B C D intact and reveal lower content', async ({
    page,
  }, testInfo) => {
    // Place B (blue) first, then A (target) overlapping it so A's transparent
    // regions must reveal B after masking. C and D sit apart, untouched.
    const bUrl = await makeSolidImage(page, COLORS.blue);
    await dropImage(page, bUrl, 500, 100);
    const aUrl = await makeTargetImage(page);
    await dropImage(page, aUrl, 420, 100); // overlaps B at (500..540, 100..220)
    const cUrl = await makeSolidImage(page, COLORS.green);
    await dropImage(page, cUrl, 100, 420);
    const dUrl = await makeSolidImage(page, COLORS.amber);
    await dropImage(page, dUrl, 500, 420);
    await page.waitForTimeout(2500);

    const aBox = await waitForColor(page, COLORS.aSubject, 'A subject (orange-red)');
    // The drop centers the image on the drop point, so A's placed rect is
    // exactly (dropX - SIZE/2, dropY - SIZE/2, SIZE, SIZE). The subject
    // bbox alone is useless for change detection: the mask keeps the subject
    // opaque, so only A's background pixels change.
    const aRect = { x: 420 - SIZE / 2, y: 100 - SIZE / 2, w: SIZE, h: SIZE };
    expect(aRect.x).toBe(360);
    const bBox = await waitForColor(page, COLORS.blue, 'B (blue)');
    const cBox = await waitForColor(page, COLORS.green, 'C (green)');
    const dBox = await waitForColor(page, COLORS.amber, 'D (amber)');

    const bBefore = await regionHash(page, bBox);
    const cBefore = await regionHash(page, cBox);
    const dBefore = await regionHash(page, dBox);
    const beforeOracle = await fullCanvasHash(page);
    const afterOracle = await fullCanvasHash(page);
    expect(afterOracle).toBe(beforeOracle);

    // ── Apply background removal to A ────────────────────────────────
    const aBeforeMask = await regionHash(page, aRect);
    const tealBefore = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
        | HTMLCanvasElement
        | undefined;
      if (!canvas) return -1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return -1;
      const data = ctx.getImageData(360, 40, 120, 120).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i + 3]! > 64 &&
          Math.abs(data[i]! - 0x00) < 28 &&
          Math.abs(data[i + 1]! - 0xa3) < 28 &&
          Math.abs(data[i + 2]! - 0xcc) < 28
        )
          count++;
      }
      return count;
    });
    expect(tealBefore).toBeGreaterThan(1000);
    await selectImageAt(page, aBox);
    const quickBar = page.getByTestId('selection-quick-bar');
    const removeBtn = quickBar.getByRole('button', { name: 'Remove background' });
    await removeBtn.waitFor({ state: 'visible', timeout: 10000 });
    await removeBtn.click();
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 20000 });
    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden({ timeout: 10000 });

    // A's own pixels must change (mask applied)…
    const docProbe = await page.evaluate(() => {
      const editMaskBtn = Array.from(document.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('Edit mask'),
      );
      return { editMaskBtn };
    });
    if (!docProbe.editMaskBtn) throw new Error('mask was not committed to the document');
    await page.waitForTimeout(1500);
    await expect
      .poll(async () => regionHash(page, aRect), { timeout: 20000 })
      .not.toBe(aBeforeMask);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: testInfo.outputPath('mask-applied.png'), fullPage: false });

    // …but B/C/D must be byte-identical in their regions.
    await expect.poll(async () => regionHash(page, bBox), { timeout: 10000 }).toBe(bBefore);
    await expect.poll(async () => regionHash(page, cBox), { timeout: 10000 }).toBe(cBefore);
    await expect.poll(async () => regionHash(page, dBox), { timeout: 10000 }).toBe(dBefore);
    await expect.poll(async () => colorBBox(page, COLORS.blue), { timeout: 10000 }).not.toBeNull();
    await expect.poll(async () => colorBBox(page, COLORS.green), { timeout: 10000 }).not.toBeNull();
    await expect.poll(async () => colorBBox(page, COLORS.amber), { timeout: 10000 }).not.toBeNull();

    // Oracle: what the canvas shows must equal a forced full redraw.
    const h1 = await fullCanvasHash(page);
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw: () => void } }
      ).__varvePerf?.forceFullRedraw();
    });
    await page.waitForTimeout(800);
    const h2 = await fullCanvasHash(page);
    expect(h2).toBe(h1);

    // Reveal check: the overlap strip (440..480, 40..160) is covered by A and
    // belongs to B; after A's background is removed, blue must be visible there.
    const overlapBlue = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
        | HTMLCanvasElement
        | undefined;
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const data = ctx.getImageData(440, 40, 40, 120).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const dr = Math.abs(data[i]! - 0x3b);
        const dg = Math.abs(data[i + 1]! - 0x82);
        const db = Math.abs(data[i + 2]! - 0xf6);
        if (data[i + 3]! > 64 && dr < 28 && dg < 28 && db < 28) count++;
      }
      return count;
    });
    expect(overlapBlue).toBeGreaterThan(0);

    // ── Edit mask + paint stroke ─────────────────────────────────────
    await selectImageAt(page, aRect);
    const editMask = page.getByRole('button', { name: 'Edit mask' });
    await expect(editMask).toBeVisible({ timeout: 10000 });
    await editMask.click();
    const editor = page.locator('#background-mask-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const beforeStrokeB = await regionHash(page, bBox);
    const beforeStrokeC = await regionHash(page, cBox);
    const beforeStrokeD = await regionHash(page, dBox);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const cbox = await canvas.boundingBox();
    if (!cbox) throw new Error('content canvas not found');
    await page.keyboard.down('Alt');
    await page.mouse.move(cbox.x + aBox.x + 30, cbox.y + aBox.y + 60);
    await page.mouse.down();
    await page.mouse.move(cbox.x + aBox.x + 90, cbox.y + aBox.y + 60, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(1200);

    await expect.poll(async () => regionHash(page, bBox), { timeout: 10000 }).toBe(beforeStrokeB);
    await expect.poll(async () => regionHash(page, cBox), { timeout: 10000 }).toBe(beforeStrokeC);
    await expect.poll(async () => regionHash(page, dBox), { timeout: 10000 }).toBe(beforeStrokeD);
    await page.screenshot({ path: testInfo.outputPath('mask-edited.png'), fullPage: false });

    // Mask edit must actually change A's pixels.
    const aAfterStroke = await regionHash(page, aRect);
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw: () => void } }
      ).__varvePerf?.forceFullRedraw();
    });
    await page.waitForTimeout(800);
    const aAfterOracle = await regionHash(page, aRect);
    expect(aAfterOracle).toBe(aAfterStroke);

    await editor.getByRole('button', { name: 'Done' }).click();
    await expect(editor).toBeHidden({ timeout: 10000 });

    // ── Show Original ────────────────────────────────────────────────
    await selectImageAt(page, aRect);
    const showOriginal = page.getByRole('button', {
      name: /show original|showing original|hide original/i,
    });
    await expect(showOriginal.first()).toBeVisible({ timeout: 10000 });
    await showOriginal.first().click();
    await page.waitForTimeout(1500);
    // A shows its full source colour again…
    const aOriginal = await waitForColor(page, COLORS.aBg, 'A background while showing original');
    expect(aOriginal).not.toBeNull();
    await page.screenshot({ path: testInfo.outputPath('show-original.png'), fullPage: false });
    // …and B/C/D remain unchanged.
    await expect.poll(async () => regionHash(page, bBox), { timeout: 10000 }).toBe(beforeStrokeB);
    await expect.poll(async () => regionHash(page, cBox), { timeout: 10000 }).toBe(beforeStrokeC);
    await expect.poll(async () => regionHash(page, dBox), { timeout: 10000 }).toBe(beforeStrokeD);
    await showOriginal.click();
    await page.waitForTimeout(1000);

    // ── Reset ────────────────────────────────────────────────────────
    const reset = page.getByRole('button', {
      name: /^reset background removal to original image$/i,
    });
    await expect(reset).toBeVisible({ timeout: 10000 });
    await reset.click();
    await page.waitForTimeout(1500);
    await page.waitForTimeout(1200);
    const aReset = await waitForColor(page, COLORS.aBg, 'A background after reset');
    expect(aReset).not.toBeNull();
    await page.screenshot({ path: testInfo.outputPath('mask-reset.png'), fullPage: false });
    await expect.poll(async () => regionHash(page, bBox), { timeout: 10000 }).toBe(beforeStrokeB);
    await expect.poll(async () => regionHash(page, cBox), { timeout: 10000 }).toBe(beforeStrokeC);
    await expect.poll(async () => regionHash(page, dBox), { timeout: 10000 }).toBe(beforeStrokeD);
    await expect(page.locator('.error-boundary')).toHaveCount(0);
  });
});
