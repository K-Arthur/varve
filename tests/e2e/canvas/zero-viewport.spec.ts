import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Zero-size viewport guard', () => {
  test('canvas paints when the editor mounts off-screen then becomes visible', async ({ page }) => {
    await page.addStyleTag({ content: '.editor-canvas { display: none !important; }' });
    await navigateToEditor(page);
    await page.waitForTimeout(200);

    await page.addStyleTag({ content: '.editor-canvas { display: flex !important; }' });
    await page.waitForTimeout(300);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 50, 50, 200, 200);
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });
});
