import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Lasso Tool', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('lasso tool shortcut (Shift+L) activates and does not crash', async ({ page }) => {
    // Start with select tool (default)
    await page.waitForTimeout(200);

    // Activate lasso tool via shortcut
    await page.keyboard.press('Shift+l');
    await page.waitForTimeout(200);

    // Verify the editor is still responsive
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();

    // Draw a simple lasso to verify the tool doesn't crash
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    const startX = box.x + 200;
    const startY = box.y + 200;
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Draw a small polygon
    const points: [number, number][] = [
      [startX + 30, startY],
      [startX + 60, startY + 30],
      [startX + 50, startY + 60],
      [startX + 20, startY + 50],
    ];

    for (const [x, y] of points) {
      if (x !== undefined && y !== undefined) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }
    }

    await page.mouse.up();
    await page.waitForTimeout(300);

    // Editor should still be alive and responsive
    await expect(canvas).toBeVisible();
    await expect(page.locator('.layers-panel')).toBeVisible();
  });

  test('lasso tool works with existing shapes on canvas', async ({ page }) => {
    // Create a shape to test with
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 200, 200);
    await page.waitForTimeout(200);

    // Switch to lasso tool
    await page.keyboard.press('Shift+l');
    await page.waitForTimeout(200);

    // Get canvas position
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Draw lasso around the shape area
    const startX = box.x + 80;
    const startY = box.y + 80;
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    const points: [number, number][] = [
      [startX + 40, startY],
      [startX + 80, startY + 20],
      [startX + 100, startY + 60],
      [startX + 80, startY + 100],
      [startX + 40, startY + 120],
      [startX, startY + 100],
      [startX - 20, startY + 60],
      [startX, startY + 20],
    ];

    for (const [x, y] of points) {
      if (x !== undefined && y !== undefined) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }
    }

    await page.mouse.up();
    await page.waitForTimeout(300);

    // Editor should still be responsive after lasso operation
    await expect(canvas).toBeVisible();
    await expect(page.locator('.layers-panel')).toBeVisible();

    // Switch back to select tool to verify editor state
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    await expect(canvas).toBeVisible();
  });

  test('lasso tool can be cancelled with Escape', async ({ page }) => {
    // Switch to lasso tool
    await page.keyboard.press('Shift+l');
    await page.waitForTimeout(200);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Start drawing a lasso
    const startX = box.x + 200;
    const startY = box.y + 200;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY + 30);

    // Press Escape to cancel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Editor should still be responsive
    await expect(canvas).toBeVisible();
    await expect(page.locator('.layers-panel')).toBeVisible();
  });
});
