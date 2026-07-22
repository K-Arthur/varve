import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Canvas performance budgets', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('create 5 shapes within the 15-second E2E noise budget', async ({ page }) => {
    const start = Date.now();
    await seedLayers(page, 5);
    const elapsed = Date.now() - start;
    await expect(page.getByRole('treeitem')).toHaveCount(5, { timeout: 10000 });
    expect(elapsed).toBeLessThan(15000);
  });

  test('zoom in and out 10 times within the 10-second E2E noise budget', async ({ page }) => {
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
    await canvas.screenshot();
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(500);

    const paint = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context || target.width === 0 || target.height === 0) {
        return { width: target.width, height: target.height, sampledColours: 0 };
      }
      const pixels = context.getImageData(0, 0, target.width, target.height).data;
      const colours = new Set<number>();
      const stride = Math.max(4, Math.floor(pixels.length / 8_000 / 4) * 4);
      for (let offset = 0; offset < pixels.length; offset += stride) {
        colours.add(
          ((pixels[offset] ?? 0) << 24) |
            ((pixels[offset + 1] ?? 0) << 16) |
            ((pixels[offset + 2] ?? 0) << 8) |
            (pixels[offset + 3] ?? 0),
        );
      }
      return { width: target.width, height: target.height, sampledColours: colours.size };
    });
    expect(paint.width).toBeGreaterThan(0);
    expect(paint.height).toBeGreaterThan(0);
    expect(paint.sampledColours).toBeGreaterThan(1);
  });

  test('undo after rapid interactions completes within the 15-second E2E noise budget', async ({
    page,
  }) => {
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
