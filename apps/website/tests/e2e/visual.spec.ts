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
 * Pin the theme before first paint. The pre-paint theme script reads
 * localStorage('varve-theme') first, then falls back to the OS. Under
 * Playwright's colorScheme emulation the OS-preference `change` listener can
 * fire mid-full-page-stitch, so a screenshot that scrolled through the
 * page could capture a mixed theme (a 6%-of-pixels dark/light band flip on
 * the homepage, 2026-08-12). Seeding the explicit choice makes the first
 * paint the target theme with nothing to race.
 */
/**
 * Warm every scroll segment before a fullPage capture. Lazy-loaded screenshots
 * decode below the fold, but the compositor may not have rasterized the new
 * segment when the stitch's CDP capture runs — the captured segment then shows
 * the page background where the image belongs (the 6% homepage-dark band
 * flip, 2026-08-12). Scrolling the full height once forces load + decode +
 * raster of every region; the stitch then captures already-painted pixels.
 */
async function warmFullPage(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await waitForImages(page);
}

async function seedTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.addInitScript((value: string) => {
    try {
      localStorage.setItem('varve-theme', value);
    } catch {
      /* storage unavailable (private mode): pre-paint script falls back to OS */
    }
  }, theme);
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

// Keep visual captures independent of the consent workflow. A fresh CI
// context otherwise paints the fixed consent banner over pages such as 404,
// while a developer browser may have a remembered choice. analytics.spec.ts
// owns the grant/withdraw boundary separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
});

const THEMES = [
  { name: 'light', colorScheme: 'light' as const },
  { name: 'dark', colorScheme: 'dark' as const },
];

test('homepage light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedTheme(page, 'light');
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('home-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('homepage dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await seedTheme(page, 'dark');
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('home-dark.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
});

test('homepage mobile light', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedTheme(page, 'light');
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('home-mobile-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('homepage mobile dark', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await seedTheme(page, 'dark');
  await page.goto('/');
  await waitForImages(page);
  await expect(page.locator('.hero-title')).toBeVisible();
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('home-mobile-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('hero light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedTheme(page, 'light');
  await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.locator('.hero')).toHaveScreenshot('hero-light.png', {
    maxDiffPixelRatio: 0.02,
  });
});

test('footer dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await seedTheme(page, 'dark');
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
  await seedTheme(page, 'light');
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
  await seedTheme(page, 'dark');
  await page.goto('/download');
  await waitForImages(page);
  await expect(page.getByRole('heading', { name: /download varve/i })).toBeVisible();
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('download-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('docs page light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedTheme(page, 'light');
  await page.goto('/docs');
  await waitForImages(page);
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('docs-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('workspaces docs page light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedTheme(page, 'light');
  await page.goto('/docs/workspaces');
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('workspaces-docs-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('features page dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await seedTheme(page, 'dark');
  await page.goto('/features');
  await waitForImages(page);
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('features-dark.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test('404 page light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedTheme(page, 'light');
  await page.goto('/definitely-missing');
  await waitForImages(page);
  await warmFullPage(page);
  await expect(page).toHaveScreenshot('404-light.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
});

test('legal page (license) light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedTheme(page, 'light');
  await page.goto('/about/license');
  await waitForImages(page);
  await warmFullPage(page);
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
      await seedTheme(page, t.colorScheme);
      await page.goto('/product');
      await waitForImages(page);
      await expect(page.getByRole('heading', { name: 'What is Varve?' })).toBeVisible();
      await warmFullPage(page);
      await expect(page).toHaveScreenshot(`product-${t.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
