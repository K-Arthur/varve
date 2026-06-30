import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Empty states', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('search with no results shows no results message', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search files...');
    await searchInput.fill('zzzznonexistent');
    await page.waitForTimeout(300);
    await expect(page.getByText(/no results/i).first()).toBeVisible();
  });
});
