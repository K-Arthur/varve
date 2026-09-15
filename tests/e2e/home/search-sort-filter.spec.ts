import { expect, test } from '@playwright/test';
import { navigateToHome } from '../shared';

test.describe('Home search, sort, and filter', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHome(page);
  });

  test('search input exists and can be typed into', async ({ page }) => {
    const search = page.locator('.varve-search__input');
    await expect(search).toBeVisible();

    await search.fill('test query');
    await expect(search).toHaveValue('test query');
  });

  test('search input has correct placeholder', async ({ page }) => {
    const search = page.locator('.varve-search__input');
    await expect(search).toHaveAttribute('placeholder', /search/i);
  });

  // As of 35c95aa ("Redesign homepage for desktop application feel"),
  // Phase 3 explicitly "simplified filter/sort controls": the toolbar's
  // Opened/Modified/Name segmented control (.search-sort-group) was
  // removed outright, not relocated within the toolbar. Sort-by-key now
  // only exists as sortable column headers in the list view
  // (packages/home/src/FileList.tsx), a different surface than this
  // toolbar-focused test file covers — no toolbar replacement test added
  // here to keep this fix scoped to what regressed, not what moved.

  test('sort direction toggle button exists', async ({ page }) => {
    const sortBtn = page.locator(
      'button[aria-label*="ascending"], button[aria-label*="descending"]',
    );
    await expect(sortBtn).toBeVisible();
  });

  test('view mode toggle exists and switches between grid and list', async ({ page }) => {
    const switcher = page.getByRole('radiogroup', { name: 'View mode' });
    const grid = switcher.getByRole('radio', { name: 'Grid' });
    const list = switcher.getByRole('radio', { name: 'List' });
    await expect(grid).toBeChecked();
    await switcher.locator('label').filter({ hasText: 'List' }).click();
    await expect(list).toBeChecked();
  });

  test('clear search button appears when query entered', async ({ page }) => {
    const search = page.locator('.varve-search__input');
    await search.fill('something');

    const clearBtn = page.locator('.varve-search__clear');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toHaveAttribute('aria-label', /clear/i);
  });
});
