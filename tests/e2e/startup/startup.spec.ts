import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

test.describe('Application startup', () => {
  test('shows branded loader then home screen on cold load', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const loader = page.locator(
      '#strata-boot-fallback, .startup-loader:not(.startup-loader--exiting)',
    );
    const sawLoader = await loader
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30_000 });
    expect(await page.getByRole('button', { name: /^new$/i }).isVisible()).toBe(true);

    if (sawLoader) {
      await expect(loader.first()).toBeHidden({ timeout: 10_000 });
    }
  });

  test('warm session flag is set after first load', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30_000 });

    const warmFlag = await page.evaluate(() => sessionStorage.getItem('strata-session-started'));
    expect(warmFlag).toBe('1');
  });

  test('home loads with branded loader setting enabled', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({
          startup: { showBrandedLoader: true },
        }),
      );
    });

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30_000 });
  });
});
