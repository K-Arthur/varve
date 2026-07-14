import { expect, test } from '@playwright/test';

import { navigateToEditor, dragOnCanvas } from '../shared';

test.describe('Canvas visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('all drawing tools render correctly on canvas', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await page.keyboard.press('o');
    await dragOnCanvas(page, 350, 100, 550, 250);
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 300, 400, 500);
    await page.keyboard.press('t');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 400);
    await page.waitForTimeout(500);
    await expect(canvas).toHaveScreenshot('all-tools-canvas.png', { maxDiffPixels: 200 });
  });
});
