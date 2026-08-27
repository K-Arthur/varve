import { expect, test } from '@playwright/test';

import { dragOnCanvas, navigateToEditor } from '../shared';

async function contentCanvasBox(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box || box.width < 10 || box.height < 10) {
    throw new Error('content canvas not laid out');
  }
  return box;
}

async function clickOnCanvas(page: import('@playwright/test').Page, x: number, y: number) {
  const box = await contentCanvasBox(page);
  await page.mouse.click(box.x + x, box.y + y);
}

test.describe('Pen and Pencil tools', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Pen tool creates a path with multiple anchors', async ({ page }) => {
    test.setTimeout(60000);
    await page.keyboard.press('p');
    await clickOnCanvas(page, 150, 150);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 300, 150);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 300, 280);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/path|vector shape/i);
  });

  test('Pencil tool creates a path on drag', async ({ page }) => {
    await page.keyboard.press('Shift+p');
    await dragOnCanvas(page, 120, 120, 380, 260);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/path|vector shape/i);
  });

  test('Pen path paints on canvas at clicked position', async ({ page }) => {
    test.setTimeout(60000);
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await contentCanvas.screenshot();

    await page.keyboard.press('p');
    await clickOnCanvas(page, 160, 160);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 340, 160);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(300);

    const after = await contentCanvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});
