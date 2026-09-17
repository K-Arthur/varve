import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Search, sort, and filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('search narrows results by name', async ({ page }) => {
    const searchInput = page.getByRole('searchbox', { name: /search files/i });
    await searchInput.fill('Design 1');
    await page.waitForTimeout(300);
    await expect(page.getByText('Design 1').first()).toBeVisible();
  });

  test('empty search shows no results message', async ({ page }) => {
    const searchInput = page.getByRole('searchbox', { name: /search files/i });
    await searchInput.fill('zzzznonexistent');
    await page.waitForTimeout(300);
    await expect(page.getByText(/no results/i)).toBeVisible();
  });

  test('sort direction toggle is interactive', async ({ page }) => {
    // The toolbar exposes one sort-direction control; the previous spec
    // referenced a removed `.search-sort-group` "Name" control.
    const sortButton = page.getByRole('button', { name: /sort (ascending|descending)/i });
    await expect(sortButton).toBeVisible();
    const before = await sortButton.getAttribute('aria-label');
    await sortButton.click();
    await page.waitForTimeout(200);
    const after = await sortButton
      .or(page.getByRole('button', { name: /sort (ascending|descending)/i }))
      .getAttribute('aria-label');
    expect(after).not.toBe(before);
    await expect(page.getByRole('grid', { name: 'File grid' })).toBeVisible();
  });
});
