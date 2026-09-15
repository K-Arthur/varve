import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Selection operation modes', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
  });

  test('replace mode selects only the newly clicked node', async ({ page }) => {
    const items = page.getByRole('treeitem');
    await items.nth(0).click();
    await items.nth(1).click();
    await page.waitForTimeout(100);
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'false');
  });

  test('Shift+add mode preserves existing selection', async ({ page }) => {
    const items = page.getByRole('treeitem');
    await items.nth(0).click();
    await items.nth(1).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(100);
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    await expect(selected).toHaveCount(2);
  });
});
