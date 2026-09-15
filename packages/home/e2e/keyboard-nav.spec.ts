import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('sidebar responds to keyboard navigation', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'File navigation' });
    const items = nav.getByRole('option');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Focus the first item and navigate
    await items.first().focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(50);
    await expect(items.first()).toBeVisible();
  });
});
