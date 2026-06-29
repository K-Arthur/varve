import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Search, sort, and filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('search narrows results by name', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search files...');
    await searchInput.fill('Design 1');
    await page.waitForTimeout(300);
    await expect(page.getByText('Design 1').first()).toBeVisible();
  });

  test('empty search shows no results message', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search files...');
    await searchInput.fill('zzzznonexistent');
    await page.waitForTimeout(300);
    await expect(page.getByText(/no results/i)).toBeVisible();
  });

  test('sort controls are interactive', async ({ page }) => {
    // The SortBy segmented control has buttons - click on "Name"
    const sortGroup = page.locator('.search-sort-group');
    const nameBtn = sortGroup.getByText('Name');
    await nameBtn.click();
    await page.waitForTimeout(200);
    await expect(page.getByRole('grid', { name: 'File grid' })).toBeVisible();
  });
});
