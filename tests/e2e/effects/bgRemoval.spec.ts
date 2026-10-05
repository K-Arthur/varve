/**
 * E2E regression test for AI background removal alpha mask rendering.
 *
 * Verifies that a generated alpha mask is actually composited onto the image:
 * background pixels reveal the artboard and foreground pixels are preserved.
 * The content canvas remains opaque where the artboard itself is painted.
 * Uses deterministic canvas pixel polling instead of fixed delays.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

const FIXTURE = path.resolve(__dirname, '../fixtures/test-image.png');
const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

async function importTestImage(page: import('@playwright/test').Page): Promise<void> {
  const importInput = page.locator('#file-import-input');
  await importInput.setInputFiles(FIXTURE);
  await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.getByRole('treeitem').first().click();
  await page.locator(CONTENT_CANVAS).waitFor({ state: 'visible', timeout: 10000 });
  // Wait for the image to be rendered (most sampled pixels are opaque).
  await page.waitForFunction(
    (selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      let transparent = 0;
      let total = 0;
      for (let y = 0; y < h; y += 5 * dpr) {
        for (let x = 0; x < w; x += 5 * dpr) {
          total++;
          if (ctx.getImageData(x, y, 1, 1)!.data[3]! < 128) transparent++;
        }
      }
      return total > 0 && transparent < total - 10;
    },
    CONTENT_CANVAS,
    { timeout: 10000 },
  );
}

async function selectQuickMethod(page: import('@playwright/test').Page): Promise<void> {
  await switchWorkspace(page, 'Photo');
  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments' }).click();
  const section = inspector.getByRole('button', { name: 'Background Removal' });
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();

  const methodSelect = inspector.getByRole('combobox', { name: 'Background removal method' });
  await methodSelect.waitFor({ state: 'visible', timeout: 10_000 });
  await methodSelect.click();
  await page.getByRole('option', { name: /Fast — instant, simple backgrounds/ }).click();
  await expect(methodSelect).toContainText('Fast — instant, simple backgrounds');
}

async function clickRemoveBackground(page: import('@playwright/test').Page): Promise<void> {
  const removeBg = page
    .locator('.editor__inspector-panel')
    .getByRole('button', { name: 'Remove background from image' });
  await expect(removeBg).toBeVisible({ timeout: 10_000 });
  await removeBg.click();
}

async function applyBackgroundRemovalPreview(page: import('@playwright/test').Page): Promise<void> {
  const review = page.getByRole('region', { name: 'Background removal review' });
  await expect(review).toBeVisible({ timeout: 15000 });
  await review.getByRole('button', { name: 'Apply result' }).click();
  await expect(review).toBeHidden({ timeout: 5000 });
}

test.describe('Background removal alpha mask rendering', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('quick-mode bg removal: background pixels are removed and foreground is preserved', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await importTestImage(page);

    // Before removal: the fixture has blue background pixels.
    const before = await page.evaluate((selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas) return { bluePixels: 0 };
      const ctx = canvas.getContext('2d');
      if (!ctx) return { bluePixels: 0 };
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      let bluePixels = 0;
      for (let y = 0; y < h; y += 5 * dpr) {
        for (let x = 0; x < w; x += 5 * dpr) {
          const d = ctx.getImageData(x, y, 1, 1)!.data;
          if (d[2]! > 200 && d[0]! < 50 && d[1]! < 50) bluePixels++;
        }
      }
      return { bluePixels };
    }, CONTENT_CANVAS);
    expect(before.bluePixels).toBeGreaterThan(0);

    await selectQuickMethod(page);
    await clickRemoveBackground(page);
    await applyBackgroundRemovalPreview(page);

    // Wait for the blue image background to reveal the artboard.
    await expect
      .poll(
        async () =>
          page.evaluate(
            ({ selector, initialBluePixels }) => {
              const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
              if (!canvas) return { blueRemoved: false, hasForeground: false };
              const ctx = canvas.getContext('2d');
              if (!ctx) return { blueRemoved: false, hasForeground: false };
              const dpr = window.devicePixelRatio || 1;
              const w = canvas.width;
              const h = canvas.height;
              let bluePixels = 0;
              let foregroundPixels = 0;
              for (let y = 0; y < h; y += 5 * dpr) {
                for (let x = 0; x < w; x += 5 * dpr) {
                  const d = ctx.getImageData(x, y, 1, 1)!.data;
                  if (d[2]! > 200 && d[0]! < 50 && d[1]! < 50) bluePixels++;
                  if (d[3]! > 128 && (d[0]! > 150 || d[1]! > 150 || d[2]! > 150))
                    foregroundPixels++;
                }
              }
              return {
                blueRemoved: bluePixels < initialBluePixels * 0.2,
                hasForeground: foregroundPixels > 0,
              };
            },
            { selector: CONTENT_CANVAS, initialBluePixels: before.bluePixels },
          ),
        { timeout: 15000 },
      )
      .toEqual({ blueRemoved: true, hasForeground: true });
  });

  test('undo/redo restores and re-applies the alpha mask', async ({ page }) => {
    test.setTimeout(60000);

    await importTestImage(page);

    // Capture pre-removal blue pixel count.
    const before = await page.evaluate((selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas) return { bluePixels: 0 };
      const ctx = canvas.getContext('2d');
      if (!ctx) return { bluePixels: 0 };
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      let bluePixels = 0;
      for (let y = 0; y < h; y += 5 * dpr) {
        for (let x = 0; x < w; x += 5 * dpr) {
          const d = ctx.getImageData(x, y, 1, 1)!.data;
          if (d[2]! > 200 && d[0]! < 50 && d[1]! < 50) bluePixels++;
        }
      }
      return { bluePixels };
    }, CONTENT_CANVAS);
    expect(before.bluePixels).toBeGreaterThan(0);

    await selectQuickMethod(page);
    await clickRemoveBackground(page);
    await applyBackgroundRemovalPreview(page);

    // Wait for the mask to be applied (blue image pixels mostly gone).
    await page.waitForFunction(
      ({ selector, initialBluePixels }) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width;
        const h = canvas.height;
        let bluePixels = 0;
        for (let y = 0; y < h; y += 5 * dpr) {
          for (let x = 0; x < w; x += 5 * dpr) {
            const d = ctx.getImageData(x, y, 1, 1)!.data;
            if (d[2]! > 200 && d[0]! < 50 && d[1]! < 50) bluePixels++;
          }
        }
        return bluePixels < initialBluePixels * 0.2;
      },
      { selector: CONTENT_CANVAS, initialBluePixels: before.bluePixels },
      { timeout: 15000 },
    );

    // Undo: background should return (blue pixels mostly restored).
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      ({ selector, initialBluePixels }) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width;
        const h = canvas.height;
        let bluePixels = 0;
        for (let y = 0; y < h; y += 5 * dpr) {
          for (let x = 0; x < w; x += 5 * dpr) {
            const d = ctx.getImageData(x, y, 1, 1)!.data;
            if (d[2]! > 200 && d[0]! < 50 && d[1]! < 50) bluePixels++;
          }
        }
        return bluePixels > initialBluePixels * 0.6;
      },
      { selector: CONTENT_CANVAS, initialBluePixels: before.bluePixels },
      { timeout: 10000 },
    );

    // Redo: mask should be reapplied.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(
      ({ selector, initialBluePixels }) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width;
        const h = canvas.height;
        let bluePixels = 0;
        for (let y = 0; y < h; y += 5 * dpr) {
          for (let x = 0; x < w; x += 5 * dpr) {
            const d = ctx.getImageData(x, y, 1, 1)!.data;
            if (d[2]! > 200 && d[0]! < 50 && d[1]! < 50) bluePixels++;
          }
        }
        return bluePixels < initialBluePixels * 0.2;
      },
      { selector: CONTENT_CANVAS, initialBluePixels: before.bluePixels },
      { timeout: 10000 },
    );
  });

  test('image import renders visible pixels on canvas', async ({ page }) => {
    test.setTimeout(30000);
    await importTestImage(page);
  });
});
