import { expect, test } from '@playwright/test';

test.describe('Home context menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.varve-home');
  });

  test('right-click opens context menu on file card', async ({ page }) => {
    const grid = page.locator('.home-grid[role="grid"]');
    const card = grid.locator('[role="gridcell"]').first();
    const count = await grid.locator('[role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.strata-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();
  });

  test('right-click context menu shows Open, Rename, Duplicate items', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.strata-ctxmenu[role="menu"]');
    await expect(ctxMenu.locator('[role="menuitem"]').filter({ hasText: 'Open' })).toBeVisible();
    await expect(ctxMenu.locator('[role="menuitem"]').filter({ hasText: 'Rename' })).toBeVisible();
    await expect(
      ctxMenu.locator('[role="menuitem"]').filter({ hasText: 'Duplicate' }),
    ).toBeVisible();
  });

  test('Escape closes context menu', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.strata-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(ctxMenu).not.toBeVisible();
  });

  test('left-click closes context menu', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.strata-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();

    await page.locator('.varve-home__toolbar').click();
    await page.waitForTimeout(200);
    await expect(ctxMenu).not.toBeVisible();
  });
});
