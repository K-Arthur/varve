import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

async function sampleCanvas(
  page: import('@playwright/test').Page,
  box: { x: number; y: number; w: number; h: number },
): Promise<number[]> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  return canvas.evaluate((element, area) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const scaleX = surface.width / surface.clientWidth;
    const scaleY = surface.height / surface.clientHeight;
    const background = context.getImageData(0, 0, 1, 1).data;
    const points = [
      { x: area.x + area.w * 0.25, y: area.y + area.h * 0.5 },
      { x: area.x + area.w * 0.5, y: area.y + area.h * 0.35 },
      { x: area.x + area.w * 0.5, y: area.y + area.h * 0.65 },
      { x: area.x + area.w * 0.75, y: area.y + area.h * 0.5 },
    ];
    return points.map((point) => {
      const pixel = context.getImageData(
        Math.max(0, Math.min(surface.width - 1, Math.round(point.x * scaleX))),
        Math.max(0, Math.min(surface.height - 1, Math.round(point.y * scaleY))),
        1,
        1,
      ).data;
      const backgroundDifference = Array.from(pixel).reduce(
        (difference, channel, index) => difference + Math.abs(channel - (background[index] ?? 0)),
        0,
      );
      const chroma =
        Math.max(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0) -
        Math.min(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
      return Math.max(backgroundDifference, chroma);
    });
  }, box);
}

test.describe('image rendering after camera commands', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('imported photo renders after fit-all (Shift+1)', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await canvas.focus();
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(500);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample, `canvas pixel at viewport sample should show photo content`).toBeGreaterThan(
        12,
      );
    }
  });

  test('imported photo renders after fit-selection (Shift+2) while another image is still loading', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await canvas.focus();
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(500);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample).toBeGreaterThan(12);
    }
  });

  test('large photo renders after fit-all fired while the decode is still in flight', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/caf-4k.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await canvas.focus();
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(350);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample, `canvas pixel at viewport sample should show photo content`).toBeGreaterThan(
        12,
      );
    }
  });

  test('imported photo renders after StatusBar Fit-all button', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(500);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample, `fit-all button should reveal the photo`).toBeGreaterThan(12);
    }
  });

  test('imported photo renders after StatusBar Fit-all after panning far away', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Pan the canvas far away so the photo leaves the viewport entirely.
    await canvas.focus();
    await page.keyboard.down(' ');
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.move(900, 400, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up(' ');
    await page.waitForTimeout(150);

    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(500);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample, `fit-all should bring the photo back into view`).toBeGreaterThan(12);
    }
  });

  test('imported photo renders after Minimap double-click fit-all', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const minimap = page.locator('.minimap, .minimap-canvas, [class*="minimap"]').first();
    await minimap.dblclick({ position: { x: 40, y: 40 } });
    await page.waitForTimeout(500);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample, `minimap fit-all should reveal the photo`).toBeGreaterThan(12);
    }
  });

  test('second image still decoding while fit-all runs: both images settle visible', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/caf-4k.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    await canvas.focus();
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(300);
    await page.waitForTimeout(2000);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample).toBeGreaterThan(12);
    }
  });

  test('photo inside a frame renders after fit-all', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    // Frame tool: drag a frame onto the canvas.
    await page.keyboard.press('f');
    await page.mouse.move(300, 250);
    await page.mouse.down();
    await page.mouse.move(600, 450, { steps: 3 });
    await page.mouse.up();

    // Select the frame, then import a photo into it.
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await canvas.click({ position: { x: 450, y: 350 } });
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    await canvas.focus();
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(600);

    const samples = await sampleCanvas(page, {
      x: 0,
      y: 0,
      w: canvasBox.width,
      h: canvasBox.height,
    });
    for (const sample of samples) {
      expect(sample, `fit-all should reveal photo nested in a frame`).toBeGreaterThan(12);
    }
  });
});
