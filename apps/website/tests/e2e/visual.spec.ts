import { expect, test } from '@playwright/test';

/**
 * Visual regression baselines.
 *
 * Screenshots are only meaningful once the corrected rendering is deliberate —
 * regenerate deliberately with:
 *   pnpm test:website:e2e -- --update-snapshots
 *
 * Baselines cover the screenshot defect surface: homepage light/dark/mobile,
 * download and docs in both themes, features, high-contrast homepage and 404.
 * Only the ghpages project runs these (custom-domain rendering is identical).
 */

const THEMES = [
  { name: 'light', colorScheme: 'light' as const, contrast: 'no-preference' as const },
  { name: 'dark', colorScheme: 'dark' as const, contrast: 'no-preference' as const },
  { name: 'hc', colorScheme: 'light' as const, contrast: 'more' as const },
];

test('homepage light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /design across disciplines/i })).toBeVisible();
  await expect(page).toHaveScreenshot('home-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('homepage dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page).toHaveScreenshot('home-dark.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
});

test('homepage mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page).toHaveScreenshot('home-mobile.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('download page dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/download');
  await expect(page).toHaveScreenshot('download-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('docs page light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/docs');
  await expect(page).toHaveScreenshot('docs-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('features page dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/features');
  await expect(page).toHaveScreenshot('features-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('homepage high-contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', contrast: 'more', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page).toHaveScreenshot('home-hc.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
});

test('404 page light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/definitely-missing');
  await expect(page).toHaveScreenshot('404-light.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
});

test('legal page (license) light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/about/license');
  await expect(page).toHaveScreenshot('license-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

// Keep the theme matrix handy for regressions beyond the fixed baselines.
test.describe('theme matrix screenshots', () => {
  for (const t of THEMES) {
    test(`product ${t.name}`, async ({ page }) => {
      await page.emulateMedia({
        colorScheme: t.colorScheme,
        contrast: t.contrast,
        reducedMotion: 'reduce',
      });
      await page.goto('/product');
      await expect(page.getByRole('heading', { name: 'What is Varve?' })).toBeVisible();
      await expect(page).toHaveScreenshot(`product-${t.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
