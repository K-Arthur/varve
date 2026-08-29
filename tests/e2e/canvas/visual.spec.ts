import { expect, test } from '@playwright/test';

import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Canvas visual regression', () => {
  test.describe.configure({ mode: 'serial' });
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
    const hint = page.locator('.micro-hint');
    if (await hint.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Dismiss the onboarding overlay before placing text so it cannot eat
      // the canvas click or change which contextual toolbar is captured.
      await hint
        .getByRole('button', { name: 'Dismiss hint' })
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await expect(hint).toHaveCount(0, { timeout: 5000 });
    }
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 400);
    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(canvas).toHaveScreenshot('all-tools-canvas.png', { maxDiffPixels: 200 });
  });
});
