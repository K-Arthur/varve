import { expect, test } from '@playwright/test';

/**
 * Full-page snapshots of long pages must not race lazy-loaded imagery:
 * Playwright stitches them by scrolling, and an image that finishes
 * decoding mid-stitch changes the capture between retries. Wait for every
 * image to be complete before any screenshot.
 */
async function waitForImages(page: import('@playwright/test').Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('img')];
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  });
}

/**
 * Visual regression baselines.
 *
 * Screenshots are only meaningful once the corrected rendering is deliberate —
 * regenerate deliberately with:
 *   pnpm test:website:e2e -- --update-snapshots
 *
 * Determinism: every snapshot runs with reduced motion emulated and the
 * design field renders its static seeded frame, so no animation can smear
 * the baselines. `?test-motion=static` is also honoured if a test needs it.
 *
 * Baselines cover the redesign surface: homepage light/dark/mobile (both
 * themes), hero, footer, product showcase, download, docs, features, 404
 * and legal. Only the ghpages project runs these (custom-domain rendering
 * is identical).
 */

const THEMES = [
  { name: 'light', colorScheme: 'light' as const },
  { name: 'dark', colorScheme: 'dark' as const },
];

test('homepage light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await expect(page).toHaveScreenshot('home-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('homepage dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await expect(page).toHaveScreenshot('home-dark.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
});

test('homepage mobile light', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await expect(page).toHaveScreenshot('home-mobile-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('homepage mobile dark', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await expect(page).toHaveScreenshot('home-mobile-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('hero light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.locator('.hero')).toHaveScreenshot('hero-light.png', {
    maxDiffPixelRatio: 0.02,
  });
});

test('footer dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForImages(page);
  const footer = page.locator('.site-footer');
  await expect(footer).toBeVisible();
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toHaveScreenshot('footer-dark.png', {
    maxDiffPixelRatio: 0.02,
  });
});

test('product showcase light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForImages(page);
  const showcase = page.locator('.showcase');
  await expect(showcase).toBeVisible();
  await showcase.scrollIntoViewIfNeeded();
  await expect(showcase).toHaveScreenshot('showcase-light.png', {
    maxDiffPixelRatio: 0.02,
  });
});

test('download page dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/download');
  await waitForImages(page);
  await expect(page.getByRole('heading', { name: /download varve/i })).toBeVisible();
  await expect(page).toHaveScreenshot('download-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('docs page light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/docs');
  await waitForImages(page);
  await expect(page).toHaveScreenshot('docs-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('features page dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/features');
  await waitForImages(page);
  await expect(page).toHaveScreenshot('features-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('404 page light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/definitely-missing');
  await waitForImages(page);
  await expect(page).toHaveScreenshot('404-light.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
});

test('legal page (license) light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/about/license');
  await waitForImages(page);
  await expect(page).toHaveScreenshot('license-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

// Keep the theme matrix handy for regressions beyond the fixed baselines.
test.describe('theme matrix screenshots', () => {
  for (const t of THEMES) {
    test(`product ${t.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme, reducedMotion: 'reduce' });
      await page.goto('/product');
      await waitForImages(page);
      await expect(page.getByRole('heading', { name: 'What is Varve?' })).toBeVisible();
      await expect(page).toHaveScreenshot(`product-${t.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
