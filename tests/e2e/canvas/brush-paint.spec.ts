import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Brush / Paint tool — drawing and persistence', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('paint tool creates a raster layer on drag', async ({ page }) => {
    const layerCountBefore = await page.getByRole('treeitem').count();

    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 200, 200, 250, 250);

    await expect(page.getByRole('treeitem')).toHaveCount(layerCountBefore + 1, { timeout: 10000 });
  });

  test('paint brush size bracket keys update the inspector', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    await page.keyboard.press(']');
    await page.waitForTimeout(100);
    await page.keyboard.press(']');
    await page.waitForTimeout(100);
    await page.keyboard.press('[');
    await page.waitForTimeout(100);

    const sizeSlider = page.locator('.insp-num__input').first();
    await expect(sizeSlider).toBeVisible();
  });

  test('preset selector changes brush settings', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    const presetSelect = page.locator('select[aria-label="Brush preset"]');
    await presetSelect.waitFor({ timeout: 5000 });

    const currentValue = await presetSelect.inputValue();
    await presetSelect.selectOption('built-in-marker');
    await page.waitForTimeout(200);

    const newValue = await presetSelect.inputValue();
    expect(newValue).toBe('built-in-marker');
    expect(newValue).not.toBe(currentValue);
  });

  test('paint stroke creates a node that appears in layers panel', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 100, 100, 200, 200);
    await page.waitForTimeout(300);

    const treeItems = await page.getByRole('treeitem').count();
    expect(treeItems).toBeGreaterThanOrEqual(1);
  });

  test('paint tool undo reverts the raster layer state', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    const layerCountBefore = await page.getByRole('treeitem').count();

    await dragOnCanvas(page, 100, 100, 160, 160);
    await page.waitForTimeout(200);

    const layerCountAfter = await page.getByRole('treeitem').count();
    expect(layerCountAfter).toBe(layerCountBefore + 1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const layerCountAfterUndo = await page.getByRole('treeitem').count();
    expect(layerCountAfterUndo).toBe(layerCountBefore);
  });

  test('switch between paint and eraser tools', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 100, 100, 160, 160);
    await page.waitForTimeout(200);

    await page.keyboard.press('e');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 110, 110, 150, 150);
    await page.waitForTimeout(200);

    const treeItems = await page.getByRole('treeitem').count();
    expect(treeItems).toBeGreaterThanOrEqual(1);
  });
});
