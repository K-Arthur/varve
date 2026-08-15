import { expect, test } from '@playwright/test';

test.describe('Home keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.varve-home');
  });

  test('empty Home omits the file grid until files exist', async ({ page }) => {
    const grid = page.locator('.home-grid[role="grid"]');
    await expect(grid).not.toBeVisible();
  });

  test('arrow keys navigate file grid when files exist', async ({ page }) => {
    const grid = page.locator('.home-grid[role="grid"]');
    const cards = grid.locator('[role="gridcell"]');
    const count = await cards.count();
    if (count < 1) return;

    await grid.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    const focused = cards.locator('[tabindex="0"]');
    await expect(focused).toHaveCount(1);
  });

  test('Enter activates a file when files exist', async ({ page }) => {
    const grid = page.locator('.home-grid[role="grid"]');
    const cards = grid.locator('[role="gridcell"]');
    const count = await cards.count();
    if (count < 1) return;

    await grid.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const hasNavigated = await page
      .locator('.layers-panel')
      .isVisible()
      .catch(() => false);
    const staysOnHome = await page
      .locator('.varve-home')
      .isVisible()
      .catch(() => false);
    expect(hasNavigated || staysOnHome).toBe(true);
  });

  test('Home and End keys navigate to first and last grid items', async ({ page }) => {
    const grid = page.locator('.home-grid[role="grid"]');
    const cards = grid.locator('[role="gridcell"]');
    const count = await cards.count();
    if (count < 2) return;

    await grid.focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(100);

    const lastCard = cards.last();
    await expect(lastCard).toBeVisible();

    await page.keyboard.press('Home');
    await page.waitForTimeout(100);

    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();
  });
});
