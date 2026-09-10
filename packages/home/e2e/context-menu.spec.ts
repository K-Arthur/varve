import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Context menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('right-click on file card shows context menu', async ({ page }) => {
    const grid = page.getByRole('grid', { name: 'File grid' });
    const card = grid.getByRole('gridcell').first();
    await card.click({ button: 'right' });
    await page.waitForTimeout(500);

    // Check context menu rendered (the ContextMenu uses role="menu")
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 3000 });
  });

  test('context menu contains file actions', async ({ page }) => {
    const grid = page.getByRole('grid', { name: 'File grid' });
    const card = grid.getByRole('gridcell').first();
    await card.click({ button: 'right' });
    await page.waitForTimeout(500);

    const menu = page.getByRole('menu');
    const items = menu.getByRole('menuitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
