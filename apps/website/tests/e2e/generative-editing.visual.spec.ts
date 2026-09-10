import { expect, test } from '@playwright/test';

async function preparePage(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((value: string) => {
    localStorage.setItem('varve-theme', value);
    localStorage.setItem('varve:website-analytics-consent', 'denied');
  }, theme);
}

test.describe('generative editing marketing pages', () => {
  test('feature page explains the available workflow', async ({ page }) => {
    await preparePage(page, 'light');
    await page.goto('/features/generative-editing?test-motion=static');
    await expect(page.getByRole('heading', { name: /make room in an image/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /one image workflow/i })).toBeVisible();
    await expect(page).toHaveScreenshot('generative-editing-feature-light.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('docs page exposes masks, controls, and synchronization behavior', async ({ page }) => {
    await preparePage(page, 'dark');
    await page.goto('/docs/tools/generative-editing?test-motion=static');
    await expect(
      page.getByRole('heading', { name: 'Generative Editing', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /build and refine the mask/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /review and accept/i })).toBeVisible();
    await expect(page).toHaveScreenshot('generative-editing-docs-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
