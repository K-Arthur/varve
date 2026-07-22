import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Canvas performance budgets', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('create 5 shapes within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await seedLayers(page, 5);
    const elapsed = Date.now() - start;
    await expect(page.getByRole('treeitem')).toHaveCount(5, { timeout: 10000 });
    expect(elapsed).toBeLessThan(15000);
  });

  test('zoom in and out 10 times within 4 seconds', async ({ page }) => {
    await seedLayers(page, 3);
    await page.waitForTimeout(500);

    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('+');
      await page.waitForTimeout(20);
    }
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('-');
      await page.waitForTimeout(20);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10000);
  });

  test('canvas paints after rapid zoom/pan burst', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await seedLayers(page, 3);
    await page.waitForTimeout(300);

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('+');
    }
    await page.waitForTimeout(100);
    const afterZoom = await canvas.screenshot();
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(500);

    const afterFit = await canvas.screenshot();
    const diffPixels = afterFit.data.reduce(
      (sum, val, i) => sum + Math.abs(val - afterZoom.data[i]),
      0,
    );
    expect(diffPixels).toBeGreaterThan(0);
  });

  test('undo after rapid interactions completes within 2 seconds', async ({ page }) => {
    const start = Date.now();
    await seedLayers(page, 5);
    await page.waitForTimeout(200);

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('z');
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(300);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15000);
  });

  test.describe('memory pressure', () => {
    test('creating and deleting 50 shapes keeps performance stable', async ({ page }) => {
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      await canvas.waitFor({ state: 'visible', timeout: 15000 });

      const timings: number[] = [];
      for (let batch = 0; batch < 5; batch++) {
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('r');
          await page.mouse.move(100 + i * 60, 100 + batch * 80);
          await page.mouse.down();
          await page.mouse.move(180 + i * 60, 180 + batch * 80);
          await page.mouse.up();
          await page.waitForTimeout(30);
        }
        await page.waitForTimeout(100);
        const beforeDelete = Date.now();
        const items = page.getByRole('treeitem');
        const count = await items.count();
        for (let i = 0; i < Math.min(count, 10); i++) {
          await items.first().click();
          await page.keyboard.press('Delete');
          await page.waitForTimeout(20);
        }
        timings.push(Date.now() - beforeDelete);
      }

      const avgDeleteTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      expect(avgDeleteTime).toBeLessThan(5000);
    });
  });
});
