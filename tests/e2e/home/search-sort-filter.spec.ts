import { expect, test } from '@playwright/test';

test.describe('Home search, sort, and filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.strata-home');
  });

  test('search input exists and can be typed into', async ({ page }) => {
    const search = page.locator('.strata-search__input');
    await expect(search).toBeVisible();

    await search.fill('test query');
    await expect(search).toHaveValue('test query');
  });

  test('search input has correct placeholder', async ({ page }) => {
    const search = page.locator('.strata-search__input');
    await expect(search).toHaveAttribute('placeholder', /search/i);
  });

  test('sort segmented control exists', async ({ page }) => {
    const sortGroup = page.locator('.search-sort-group');
    await expect(sortGroup).toBeVisible();

    await expect(sortGroup.getByText('Opened')).toBeVisible();
    await expect(sortGroup.getByText('Modified')).toBeVisible();
    await expect(sortGroup.getByText('Name')).toBeVisible();
  });

  test('sort direction toggle button exists', async ({ page }) => {
    const sortBtn = page.locator('.search-sort-group button[aria-label*="ascending"], .search-sort-group button[aria-label*="descending"]');
    await expect(sortBtn).toBeVisible();
  });

  test('view mode toggle exists with grid and list options', async ({ page }) => {
    await expect(page.getByLabel('View')).toBeVisible();
    await expect(page.getByRole('button', { name: /grid/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /list/i })).toBeVisible();
  });

  test('clear search button appears when query entered', async ({ page }) => {
    const search = page.locator('.strata-search__input');
    await search.fill('something');

    const clearBtn = page.locator('.strata-search__clear');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toHaveAttribute('aria-label', /clear/i);
  });
});
