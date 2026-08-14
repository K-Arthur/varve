import { expect, test } from '@playwright/test';

test.describe('asset similarity marketing surface', () => {
  test('exposes honest scope and remains readable on mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('/features/asset-similarity');
    await expect(page.getByRole('heading', { name: 'Asset Similarity' })).toBeVisible();
    await expect(page.getByText(/image-to-image inference/i)).toBeVisible();
    await expect(page.getByText(/text-to-image inference/i)).toBeVisible();
    await expect(page.getByText('Experimental', { exact: true }).last()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const layout = await page.locator('.feature-page').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  });

  test('is discoverable from the feature and documentation indexes', async ({ page }) => {
    await page.goto('/features');
    await expect(page.getByRole('link', { name: /Asset Similarity/i })).toBeVisible();
    await page.goto('/docs');
    await expect(page.getByRole('link', { name: /Asset Similarity/i })).toBeVisible();
  });
});
