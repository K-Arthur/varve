import { expect, test } from '@playwright/test';

test('background-removal feature page is accurate and usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/features/background-removal');

  await expect(page.getByRole('heading', { name: /cut out subjects/i })).toBeVisible();
  const modeGrid = page.locator('.mode-grid');
  await expect(modeGrid).toHaveCount(1);
  expect(
    await modeGrid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    ),
  ).toBe(1);
  await expect(page.getByRole('heading', { name: 'Fast' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Auto' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'High quality' })).toBeVisible();
  await expect(page).toHaveScreenshot('background-removal-feature-mobile-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('background-removal guidance is readable on a light desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/features/background-removal');
  const modeGrid = page.locator('.mode-grid');
  await expect(
    page.getByRole('heading', { name: 'Keep fine details under your control' }),
  ).toBeVisible();
  expect(
    await modeGrid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    ),
  ).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot('background-removal-feature-desktop-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
