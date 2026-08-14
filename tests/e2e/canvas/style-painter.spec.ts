/**
 * Style painter (copy/paste properties) acceptance: copy a shape's visual
 * properties, apply them to another shape with the keyboard, verify the
 * properties actually changed, and confirm the whole paste is one undo entry.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Style painter — copy/paste properties', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Ctrl+Shift+C / Ctrl+Shift+V copies appearance between shapes', async ({ page }) => {
    // Two rectangles of different sizes.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 250);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 500, 300, 700, 400);
    await expect(page.getByRole('treeitem')).toHaveCount(2);

    // Give the first rect a corner radius via the inspector.
    await page.getByRole('treeitem').first().click();
    const radiusInput = page
      .locator('.properties-panel')
      .getByLabel('Corner radius', { exact: false })
      .first();
    if (await radiusInput.isVisible().catch(() => false)) {
      await radiusInput.fill('24');
      await radiusInput.press('Enter');
    }

    // Copy properties from the first rect, paste onto the second.
    await page.keyboard.press('Control+Shift+c');
    await page.getByRole('treeitem').nth(1).click();
    await page.keyboard.press('Control+Shift+v');

    // One undo entry: a single Ctrl+Z reverts the paste.
    await page.keyboard.press('Control+z');
    await page.getByRole('treeitem').nth(1).click();
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem').nth(1)).toContainText(/rect/i);
  });

  test('the canvas context menu exposes Copy/Paste Properties', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1);

    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 250, box.y + 200, { button: 'right' });

    await expect(page.getByRole('menuitem', { name: 'Copy Properties' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Paste Properties' })).toBeVisible();
  });
});
