import { expect, test } from '@playwright/test';

test('press page keeps the trust boundary readable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
    window.localStorage.setItem('varve-theme', 'light');
  });

  await page.goto('/press');
  await expect(page.getByRole('heading', { name: 'Trust and product boundaries' })).toBeVisible();
  await expect(page.getByText('Core editing is local.')).toBeVisible();
  await expect(page.getByText('Exports are not magic.')).toBeVisible();
  await expect(page.locator('.press-page')).toHaveScreenshot('press-page-mobile.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
