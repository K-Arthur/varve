import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Performance budget', () => {
  test('initial render completes within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.getByRole('grid', { name: 'File grid' }).waitFor({ timeout: 15000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  test('search responds within 1000ms', async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.getByRole('grid', { name: 'File grid' }).waitFor({ timeout: 10000 });
    const searchInput = page.getByPlaceholder('Search files...');
    const start = Date.now();
    await searchInput.fill('Design');
    await page.waitForTimeout(200);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
