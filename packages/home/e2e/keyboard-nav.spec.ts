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
    const items = nav.locator('.sidebar-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Focus the first item and navigate with arrows
    await items.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(0)).toBeFocused();
  });

  test('arrow keys reach project entries', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'File navigation' });
    const items = nav.locator('.sidebar-item');
    // Entries: Recent(0), All Files(1), Drafts(2), Favorites(3), projects(4+).
    // Project rows previously stalled arrow navigation because focus was sent
    // to a non-focusable wrapper div.
    await items.first().focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(nav.getByRole('button', { name: /^brand/i })).toBeFocused();
  });
});
