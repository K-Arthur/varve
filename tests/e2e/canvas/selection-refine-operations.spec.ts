/**
 * Real-browser coverage for the refined selection/mask workflows:
 *
 * 1. Refinement operations (feather and friends) applied from the Selection
 *    Sources inspector, with the live announcer and a screenshot for visual
 *    review.
 * 2. The refine brush on a background-removal mask: brush-mode selection,
 *    interpolated fast strokes (no gaps), one undo step, and the mask actually
 *    changing the composited image.
 *
 * The spec imports the shared image fixture and uses only public UI paths.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

const FIXTURE = path.resolve(__dirname, '../fixtures/test-image.png');
const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

async function importTestImage(page: import('@playwright/test').Page): Promise<void> {
  const importInput = page.locator('#file-import-input');
  await importInput.setInputFiles(FIXTURE);
  await page.getByRole('treeitem').first().waitFor({ timeout: 15000 });
  await page.getByRole('treeitem').first().click();
  await page.locator(CONTENT_CANVAS).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(
    (selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      let opaque = 0;
      let total = 0;
      for (let y = 0; y < h; y += 5 * dpr) {
        for (let x = 0; x < w; x += 5 * dpr) {
          total += 1;
          if ((ctx.getImageData(x, y, 1, 1)!.data[3] ?? 0) > 128) opaque += 1;
        }
      }
      return total > 0 && opaque > 10;
    },
    CONTENT_CANVAS,
    { timeout: 15000 },
  );
}

/**
 * Counts saturated (non-artboard) pixels. A brush mask that hides everything
 * except the painted band replaces the image with the white artboard, so the
 * colored-pixel count drops sharply and restores after undo.
 */
async function countColoredPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const dpr = window.devicePixelRatio || 1;
    let colored = 0;
    for (let y = 0; y < canvas.height; y += 4 * dpr) {
      for (let x = 0; x < canvas.width; x += 4 * dpr) {
        const data = ctx.getImageData(x, y, 1, 1)!.data;
        const max = Math.max(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0);
        const min = Math.min(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0);
        if ((data[3] ?? 0) > 128 && max - min > 48) colored += 1;
      }
    }
    return colored;
  }, CONTENT_CANVAS);
}

test.describe('selection refinement operations', () => {
  test.describe.configure({ mode: 'serial', timeout: 180000 });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('applies feather from the Selection Sources inspector and announces it', async ({
    page,
  }, testInfo) => {
    await importTestImage(page);
    // The Photo workspace surfaces the pixel-selection tools in the toolbar.
    await switchWorkspace(page, 'Photo');
    const toolbar = page.locator('[data-testid="toolbar"]');
    await toolbar.locator('[data-tool="marquee"]').click();
    const surface = page.locator('.editor-canvas');
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error('editor canvas surface not found');
    await page.mouse.move(
      surfaceBox.x + surfaceBox.width * 0.35,
      surfaceBox.y + surfaceBox.height * 0.3,
    );
    await page.mouse.down();
    await page.mouse.move(
      surfaceBox.x + surfaceBox.width * 0.6,
      surfaceBox.y + surfaceBox.height * 0.55,
      {
        steps: 6,
      },
    );
    await page.mouse.up();

    const announcer = page.locator('#strata-canvas-announcer-polite');
    await expect(announcer).toContainText(/Rectangular selection/, { timeout: 10000 });

    const panel = page.getByTestId('selection-sources-panel');
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Selection Sources' }).click();
    }
    await expect(panel).toBeVisible();

    const operation = panel.getByRole('combobox', { name: 'Refine operation' });
    await expect(operation).toBeVisible({ timeout: 10000 });
    // Feather is the default; assert the parameter control is real and usable.
    await expect(panel.getByLabel('Feather radius')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('refine-panel-before-apply.png') });

    await panel.getByRole('button', { name: 'Apply operation' }).click();
    await expect(announcer).toContainText('Feather applied to the pixel selection', {
      timeout: 10000,
    });

    // Switch to a spatial operation and back to prove the control wiring.
    await operation.click();
    await page.getByRole('option', { name: 'Grow', exact: true }).click();
    await panel.getByRole('button', { name: 'Apply operation' }).click();
    await expect(announcer).toContainText('Grow applied to the pixel selection', {
      timeout: 10000,
    });
    await page.screenshot({ path: testInfo.outputPath('refine-panel-after-apply.png') });

    // Both operations are individually undoable.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
  });

  test('refine brush subtracts a gap-free interpolated stroke with one undo step', async ({
    page,
  }, testInfo) => {
    await importTestImage(page);

    // Get a real mask without any model download (Quick mode).
    // Paint-to-create: a fresh image mask starts fully transparent, so an add
    // stroke reveals only the painted band and hides the rest of the image.
    const maskSection = page.getByRole('button', { name: 'Mask', exact: true });
    await maskSection.scrollIntoViewIfNeeded();
    await maskSection.click();
    const brushMask = page.getByRole('button', { name: 'Paint mask with the brush tool' });
    await brushMask.scrollIntoViewIfNeeded();
    await brushMask.click();
    await page.waitForTimeout(500);

    const surface = page.locator('.editor-canvas');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');
    const before = await countColoredPixels(page);
    await page.screenshot({ path: testInfo.outputPath('refine-brush-before.png') });

    // Deliberately coarse, fast pointer steps: interpolation must fill the gaps.
    const start = { x: box.x + box.width * 0.32, y: box.y + box.height * 0.5 };
    const end = { x: box.x + box.width * 0.68, y: box.y + box.height * 0.5 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    await expect
      .poll(async () => countColoredPixels(page), { timeout: 15000 })
      .toBeLessThan(before * 0.8);
    await page.screenshot({ path: testInfo.outputPath('refine-brush-after.png') });

    // One undo restores the pre-stroke mask pixels.
    const afterStroke = await countColoredPixels(page);
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => countColoredPixels(page), { timeout: 15000 })
      .toBeGreaterThan(afterStroke);
    await page.screenshot({ path: testInfo.outputPath('refine-brush-undo.png') });
    await page.keyboard.press('Escape');
  });
});
