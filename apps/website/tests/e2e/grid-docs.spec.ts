import { expect, test } from '@playwright/test';

test.describe('Grid systems marketing documentation', () => {
  test('documents the independent grid controls', async ({ page }) => {
    await page.goto('/docs/tools/grids');
    await expect(page).toHaveTitle(/Grid Systems/);
    await expect(page.getByRole('heading', { name: 'Document grid' })).toBeVisible();
    await expect(page.getByText('Snap to document grid', { exact: false })).toBeVisible();
    await expect(page.getByText('Frame layout guides', { exact: true })).toBeVisible();
    await expect(
      page.getByText('They never arrange or resize children.', { exact: false }),
    ).toBeVisible();

    await page.screenshot({ path: 'test-results/grid-docs-desktop.png', fullPage: true });
  });

  test('keeps the guide readable on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/docs/tools/grids');
    await expect(page.getByRole('heading', { name: 'Grid systems' })).toBeVisible();
    await expect(page.locator('.docs-page')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: 'test-results/grid-docs-mobile.png', fullPage: true });
  });
});
