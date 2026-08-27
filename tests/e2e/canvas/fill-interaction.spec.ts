/**
 * Fill interaction E2E — the non-solid fill regression suite.
 *
 * Locks in the repaired semantics:
 *  - "+ Add fill" creates a fill in ONE click (no two-step tab + Add).
 *  - Existing Fill type conversion is immediate and renders without any
 *    extra interaction (no reselect/pan/zoom).
 *  - Image/Pattern converts show an explicit empty state and paint
 *    transparent (no grey placeholder papering over the lower fills).
 *  - Chosen image/tile pixels appear automatically (async load → repaint).
 *  - Undo/redo round-trips.
 *
 * Pixel validation samples the live content canvas, per the project rule
 * "DOM assertions alone are insufficient" for canvas features.
 */
import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { navigateToCleanEditor } from '../helpers/nav';

// ── deterministic fixture PNGs (no binary fixtures in the repo) ─────────────

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** 32x24: left half pure red, right half pure blue — obvious distinct pixels. */
const IMAGE_PNG = png(32, 24, (x) =>
  x < 16 ? [200, 30, 30, 255] : [30, 60, 200, 255],
);

/** 8x8 black/white checker — repetition is mechanically verifiable. */
const TILE_PNG = png(8, 8, (x, y) => {
  const black = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
  return black ? [20, 20, 20, 255] : [235, 235, 235, 255];
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function createRect(page: Page): Promise<{ box: { x: number; y: number } }> {
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
  return { box };
}

async function samplePixels(
  page: Page,
  points: Array<{ x: number; y: number }>,
): Promise<Array<[number, number, number, number]>> {
  return page.evaluate((pts) => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    if (!canvas) return pts.map(() => [0, 0, 0, 0]);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return pts.map(() => [0, 0, 0, 0]);
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return pts.map((p) => {
      const cx = Math.round((p.x - r.left) * dpr);
      const cy = Math.round((p.y - r.top) * dpr);
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0] as [number, number, number, number];
    });
  }, points);
}

const TEAL: [number, number, number, number] = [57, 208, 198, 255];

function pixelDist(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function pixelCloseTo(a: [number, number, number, number] | null, b: [number, number, number, number], tol = 14): boolean {
  if (!a) return false;
  return (
    Math.abs(a[0] - b[0]) <= tol &&
    Math.abs(a[1] - b[1]) <= tol &&
    Math.abs(a[2] - b[2]) <= tol &&
    Math.abs(a[3] - b[3]) <= tol
  );
}

async function fillRowCount(page: Page): Promise<number> {
  return page.locator('.insp-fill-row').count();
}

async function addFill(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: /add fill/i }).first();
  await trigger.click();
  await page.getByRole('menuitem', { name: label }).click();
  await page.waitForTimeout(600);
}

async function switchFillType(page: Page, label: string): Promise<void> {
  const combo = page.getByRole('combobox', { name: /fill type/i }).first();
  await combo.click();
  await page.waitForTimeout(250);
  await page.getByRole('option', { name: new RegExp(`^${label}$`, 'i') }).click();
  await page.waitForTimeout(700);
}

/** Poll until the rect pixel at `point` is within `tol` of `expected`. */
async function expectPixel(
  page: Page,
  point: { x: number; y: number },
  expected: [number, number, number, number],
  tol: number,
  maxTries = 20,
): Promise<void> {
  for (let i = 0; i < maxTries; i++) {
    const [p] = await samplePixels(page, [point]);
    if (p && Math.abs(p[0] - expected[0]) <= tol && Math.abs(p[1] - expected[1]) <= tol && Math.abs(p[2] - expected[2]) <= tol && Math.abs(p[3] - expected[3]) <= tol) {
      return;
    }
    await page.waitForTimeout(250);
  }
  const [last] = await samplePixels(page, [point]);
  const diag = await page.evaluate(() => ({
    fileInputs: document.querySelectorAll('.insp-image-fill__file').length,
    previewImgs: document.querySelectorAll('.insp-image-fill__preview-img').length,
    emptyHint: !!document.querySelector('.insp-image-fill__empty-hint'),
    choose: Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim()).filter((t) => t === 'Choose image' || t === 'Replace image'),
    srcInputs: Array.from(document.querySelectorAll('input[aria-label="Image source URL"]')).map((i) => (i as HTMLInputElement).value.slice(0, 40)),
  }));
  throw new Error(
    `pixel at ${JSON.stringify(point)} never reached ${JSON.stringify(expected)}; last=${JSON.stringify(last)}; diag=${JSON.stringify(diag)}`,
  );
}

test.describe('fill creation and conversion', () => {
  test('one-click Add fill → Linear gradient creates, renders, and preserves the source colour', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    const left = { x: box.x + 170, y: box.y + 190 };
    const right = { x: box.x + 430, y: box.y + 310 };

    const before = await samplePixels(page, [left]);
    expect(pixelCloseTo(before[0]!, TEAL)).toBe(true);

    expect(await fillRowCount(page)).toBe(1);
    await addFill(page, 'Linear gradient');

    expect(await fillRowCount(page)).toBe(2);
    const gradEditor = page.locator('.gradient-editor');
    await gradEditor.waitFor({ state: 'visible', timeout: 5000 });

    const sample = await samplePixels(page, [left, right]);
    // Stop 0 is seeded from the user's solid: the gradient's source end is
    // far closer to the original teal than the far end (OKLab interpolation
    // shifts even the first sampled post-stop pixels, so use relative
    // distance rather than an exact colour match).
    const distLeft = pixelDist(sample[0]!, TEAL);
    const distRight = pixelDist(sample[1]!, TEAL);
    expect(distRight).toBeGreaterThan(60);
    expect(distLeft).toBeLessThan(distRight / 2);
    // Not a flat fill: the two ends are measurably different.
    expect(distLeft + distRight).toBeGreaterThan(100);

    // Undo → back to one fill; redo → two fills.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    expect(await fillRowCount(page)).toBe(1);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(500);
    expect(await fillRowCount(page)).toBe(2);
  });

  test('existing Fill type conversion Solid → Gradient renders immediately', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    const left = { x: box.x + 170, y: box.y + 190 };
    const right = { x: box.x + 430, y: box.y + 310 };

    const before = await samplePixels(page, [left]);
    expect(pixelCloseTo(before[0]!, TEAL)).toBe(true);

    await switchFillType(page, 'Gradient');
    const gradientEditor = page.locator('.gradient-editor');
    await gradientEditor.waitFor({ state: 'visible', timeout: 5000 });
    const sample = await samplePixels(page, [left, right]);
    expect(pixelDist(sample[1]!, TEAL)).toBeGreaterThan(60);
    expect(pixelDist(sample[0]!, TEAL)).toBeLessThan(pixelDist(sample[1]!, TEAL) / 2);
  });

  test('Solid → Image shows an explicit empty state and renders transparent inside the shape', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    const center = { x: box.x + 300, y: box.y + 250 };
    const outside = { x: box.x + 80, y: box.y + 100 };

    await switchFillType(page, 'Image');
    await page.locator('.insp-image-fill__empty-hint').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /choose image/i }).waitFor({ state: 'visible' });

    const sampled = await samplePixels(page, [center, outside]);
    // Transparent empty source: the shape's interior shows the artboard
    // background — identical to the surrounding artboard pixel — instead of
    // a grey placeholder rectangle.
    expect(pixelDist(sampled[0]!, sampled[1]!)).toBeLessThan(6);
    expect(pixelCloseTo(sampled[0]!, TEAL)).toBe(false);
  });

  test('choose image file → image pixels appear with no extra interaction', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    await switchFillType(page, 'Image');
    await page.locator('.insp-image-fill__empty-hint').waitFor({ state: 'visible', timeout: 5000 });

    // The object is 300x200; the image is 32x24 with red left / blue right.
    // fit=fill stretches it to the bounds, so left ≈ red, right ≈ blue.
    // Use the real user path: click Choose image → OS file dialog → confirm.
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /choose image/i }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'fill-fixture.png',
      mimeType: 'image/png',
      buffer: IMAGE_PNG,
    });
    // The image resolves asynchronously (FileReader → asset register → cache
    // load → repaint); poll, don't sleep — the loaded image must APPEAR
    // automatically without any selection/pan/zoom interaction.
    await expectPixel(page, { x: box.x + 170, y: box.y + 190 }, [200, 30, 30, 255], 20);
    await expectPixel(page, { x: box.x + 430, y: box.y + 310 }, [30, 60, 200, 255], 20);

    // Undo the source change → empty again; redo → visible again.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    const undoSampled = await samplePixels(page, [{ x: box.x + 170, y: box.y + 190 }]);
    expect(undoSampled[0]).toBeTruthy();
    expect(pixelCloseTo(undoSampled[0]!, [200, 30, 30, 255], 20)).toBe(false);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(600);
    await expectPixel(page, { x: box.x + 170, y: box.y + 190 }, [200, 30, 30, 255], 20);
  });

  test('choose tile file → repeating pattern pixels appear', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    await switchFillType(page, 'Pattern');
    await page.locator('.insp-image-fill__empty-hint').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /choose tile/i }).waitFor({ state: 'visible' });

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /choose tile/i }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'tile-fixture.png',
      mimeType: 'image/png',
      buffer: TILE_PNG,
    });
    await page.waitForTimeout(2000);
    // Tile is 8x8 with 4px checker cells; sample across 4px cell boundaries so
    // both colours are present — that proves repetition, not a flat fallback.
    const points = Array.from({ length: 8 }, (_, i) => ({
      x: box.x + 170 + i * 4,
      y: box.y + 220,
    }));
    const sampled = await samplePixels(page, points);
    const darkCount = sampled.filter((p) => pixelCloseTo(p, [20, 20, 20, 255], 30)).length;
    const lightCount = sampled.filter((p) => pixelCloseTo(p, [235, 235, 235, 255], 30)).length;
    expect(darkCount).toBeGreaterThan(0);
    expect(lightCount).toBeGreaterThan(0);
    expect(darkCount + lightCount).toBeGreaterThanOrEqual(points.length - 2);
  });
});

test.describe('fill stack semantics', () => {
  test('adding a gradient on top keeps the solid underneath, and the gradient paints above', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    const left = { x: box.x + 170, y: box.y + 190 };

    await addFill(page, 'Linear gradient');
    expect(await fillRowCount(page)).toBe(2);

    // Bottom fill = solid teal, top = gradient. Hide the top gradient → teal
    // reappears (per-fill visibility works).
    await page.getByRole('button', { name: /^hide fill 2$/i }).click();
    await page.waitForTimeout(600);
    const hidden = await samplePixels(page, [left]);
    expect(pixelCloseTo(hidden[0]!, TEAL, 18)).toBe(true);
  });
});

test.describe('/try demo parity', () => {
  test('Solid → Gradient and the add-fill menu work in demo mode', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/?try=1', { timeout: 120000, waitUntil: 'domcontentloaded' });
    const inSafeMode = await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null);
    if (inSafeMode) {
      await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
      await page.reload({ timeout: 120000 });
    }
    const newBtn = page.getByRole('button', { name: /^new$/i });
    await newBtn.waitFor({ state: 'visible', timeout: 150000 });
    await newBtn.click({ force: true, timeout: 15000 });
    const createBtn = page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create design$/i });
    if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createBtn.click({ timeout: 10000 }).catch(() => undefined);
    }
    await page.locator('.layers-panel').waitFor({ timeout: 150000 });
    const demoBanner = page.locator('.varve-demo-banner');
    await demoBanner.waitFor({ state: 'visible', timeout: 15000 });

    // Dismiss demo-specific overlays that swallow pointer events. Use
    // evaluate-clicks and direct dialog close(): a full-viewport transparent
    // layer eats Playwright's actionability check but cannot intercept a
    // direct element click.
    const noThanks = page.getByRole('button', { name: /no thanks/i });
    if ((await noThanks.count()) > 0) {
      await noThanks.evaluate((el) => (el as HTMLButtonElement).click()).catch(() => undefined);
      await page.waitForTimeout(300);
    }
    const dismissNotice = page.getByRole('button', { name: /dismiss demo notice/i });
    if ((await dismissNotice.count()) > 0) {
      await dismissNotice.evaluate((el) => (el as HTMLButtonElement).click()).catch(() => undefined);
      await page.waitForTimeout(300);
    }
    // The demo's analytics modal can appear on a delay; poll-close every open
    // dialog so no transparent backdrop keeps intercepting pointer events.
    for (let i = 0; i < 10; i++) {
      const closed = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('dialog[open]'));
        for (const d of dialogs) {
          try {
            (d as HTMLDialogElement).close();
          } catch {
            /* not closeable programmatically */
          }
        }
        return dialogs.length;
      });
      if (closed === 0) break;
      await page.waitForTimeout(500);
    }

    // The demo opens the poster template document. Draw a fresh rectangle via
    // keyboard (overlay-proof) so it becomes the top object, then select it by
    // clicking its centre (topmost hit).
    await page.keyboard.press('r');
    const canvasEl = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvasEl.boundingBox();
    if (!canvasBox) throw new Error('no canvas');
    await page.mouse.move(canvasBox.x + 150, canvasBox.y + 150);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 450, canvasBox.y + 350);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.press('v');
    // Select our rectangle by name — centre-click can hit template artwork
    // laid on top of it in the demo poster.
    const rectRow = page.locator('.layers-row', { hasText: 'Rectangle' }).last();
    await rectRow.click();
    await page.waitForTimeout(500);
    // Sample points inside the rect and clear of template artwork.
    const p1 = { x: canvasBox.x + 170, y: canvasBox.y + 320 };
    const p2 = { x: canvasBox.x + 390, y: canvasBox.y + 320 };
    const before = await samplePixels(page, [p1, p2]);

    // Existing-fill conversion (Route B) must behave identically to the
    // non-demo runtime: gradient editor appears, pixels change and vary
    // spatially (the demo's default fill colour is template-specific, so
    // assert against the pre-conversion sample, not a fixed colour).
    await switchFillType(page, 'Gradient');
    await page.locator('.gradient-editor').waitFor({ state: 'visible', timeout: 5000 });
    const grad = await samplePixels(page, [p1, p2]);
    expect(pixelDist(grad[0]!, grad[1]!)).toBeGreaterThan(30);
    const changedDist = pixelDist(grad[0]!, before[0]!);
    expect(changedDist).toBeGreaterThan(10);

    // The one-click add-fill menu must also work in the demo.
    await addFill(page, 'Image');
    expect(await fillRowCount(page)).toBe(2);
    await page.locator('.insp-image-fill__empty-hint').waitFor({ state: 'visible', timeout: 5000 });
  });
});
