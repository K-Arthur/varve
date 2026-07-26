import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Canvas name labels', () => {
  test('labels artwork but never exposes the active page content root', async ({ page }) => {
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('f');
    await page.mouse.move(box.x + 200, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 340);
    await page.mouse.up();

    const zoom = page.locator('.editor-menubar__zoom-input');
    await zoom.fill('20');
    await zoom.press('Enter');

    const labels = page.locator('.canvas-name-labels');
    await expect(labels.getByText('Frame 1', { exact: true })).toBeVisible();
    await expect(labels.getByText(/Page 1 content/i)).toHaveCount(0);
    await expect(page.locator('.selection-info-bar').getByText(/Page 1 content/i)).toHaveCount(0);
  });
});
