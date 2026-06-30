import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('page has accessible file grid', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'File grid' })).toBeVisible();
  });

  test('page has accessible file navigation', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'File navigation' })).toBeVisible();
  });

  test('sidebar items have accessible roles', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'File navigation' });
    const items = nav.getByRole('option');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(6); // Recent, All, 3 projects, Templates, Trash
  });

  test('file cards have accessible labels', async ({ page }) => {
    const grid = page.getByRole('grid', { name: 'File grid' });
    const cards = grid.getByRole('gridcell');
    const firstCard = cards.first();
    const label = await firstCard.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });
});
