import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Marquee Selection Modes', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
  });

  test('replace mode selects only new nodes', async ({ page }) => {
    await page.mouse.click(10, 10);
    await page.waitForTimeout(100);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.move(box.x + 50, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 350, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    const count = await selected.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('Shift+add mode preserves existing selection', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 250, box.y + 250);
    await page.waitForTimeout(100);
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    const count = await selected.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
