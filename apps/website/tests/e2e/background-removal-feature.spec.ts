import { expect, test } from '@playwright/test';

test('background-removal feature page is accurate and usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/features/background-removal');

  await expect(page.getByRole('heading', { name: /cut out subjects/i })).toBeVisible();
  await expect(page.locator('.mode-grid')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Fast' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Auto' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'High quality' })).toBeVisible();
  await expect(page).toHaveScreenshot('background-removal-feature-mobile-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
