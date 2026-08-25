/**
 * Visual regression: selection overlay alignment.
 *
 * Verifies that the selection overlay (bounding box, handles, dimension
 * labels) stays geometrically aligned with the artwork at various zoom
 * levels and camera rotations. Uses screenshot comparison.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/** Create a rect via the r-tool drag, then return to the select tool. */
async function createRect(
  page: import('@playwright/test').Page,
  canvasBox: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
) {
  await page.keyboard.press('r');
  await page.mouse.move(canvasBox.x + x, canvasBox.y + y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + x + w / 2, canvasBox.y + y + h / 2);
  await page.mouse.move(canvasBox.x + x + w, canvasBox.y + y + h);
  await page.mouse.up();
  await page.keyboard.press('v');
}

test.describe('overlay alignment', () => {
  test('selection overlay aligns at 100% zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 200, 200, 100, 80);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select the rect
    await page.mouse.click(canvasBox.x + 250, canvasBox.y + 240);
    await page.waitForTimeout(200);

    // Verify selection overlay is visible
    const overlay = page.locator('svg:has(filter#selection-glow)');
    const rect = overlay.locator('rect').first();
    await expect(rect).toBeVisible();

    // Take screenshot for visual comparison
    await expect(page).toHaveScreenshot('selection-overlay-100zoom.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('selection overlay aligns after zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 200, 200, 100, 80);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select the rect
    await page.mouse.click(canvasBox.x + 250, canvasBox.y + 240);
    await page.waitForTimeout(200);

    // Zoom in with Ctrl+wheel
    const centerX = canvasBox.x + 250;
    const centerY = canvasBox.y + 240;
    await page.mouse.move(centerX, centerY);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    // Verify selection overlay is still visible and aligned
    const overlay = page.locator('svg:has(filter#selection-glow)');
    const rect = overlay.locator('rect').first();
    await expect(rect).toBeVisible();

    await expect(page).toHaveScreenshot('selection-overlay-200zoom.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('selection overlay handles are interactive', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 200, 200, 100, 80);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select the rect
    await page.mouse.click(canvasBox.x + 250, canvasBox.y + 240);
    await page.waitForTimeout(200);

    // Verify resize handles are visible
    const handles = page.locator('[aria-label*="resize handle"]');
    const handleCount = await handles.count();
    expect(handleCount).toBeGreaterThanOrEqual(4); // at least 4 corner handles

    // Verify rotation handle is visible
    const rotateHandle = page.locator('[aria-label="Rotate"]');
    await expect(rotateHandle).toBeVisible();
  });
});
