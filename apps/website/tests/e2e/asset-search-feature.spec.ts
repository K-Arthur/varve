import { expect, test } from '@playwright/test';

test('asset search feature page explains the local retrieval boundary', async ({ page }) => {
  await page.goto('/features/asset-search');
  await expect(page).toHaveTitle(/local asset search/i);
  await expect(page.getByRole('heading', { name: 'Find the asset you remember.' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'One search, several useful signals' }),
  ).toBeVisible();
  await expect(page.getByText('Visual search is opt-in and experimental')).toBeVisible();
  await expect(page.locator('.search-demo__field')).toContainText('orange sunset over mountains');
});

test('asset search page remains usable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/features/asset-search');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('link', { name: 'Download Varve' })).toBeVisible();
});
