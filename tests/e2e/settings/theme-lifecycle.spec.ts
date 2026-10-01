import { expect, test } from '@playwright/test';

test.describe('application theme lifecycle', () => {
  test('System resolves before paint and follows an OS change', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('varve-theme', 'system');
    });
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('invalid storage falls back safely while high contrast overrides the OS', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('varve-theme', 'sepia'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.evaluate(() => localStorage.setItem('varve-theme', 'high-contrast'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'high-contrast');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  });

  test('OS contrast preference resolves System to High Contrast', async ({ page }) => {
    // Design contract (DESIGN.md): High Contrast activates via
    // prefers-contrast: more or explicit selection; the pre-paint script and
    // the runtime must agree, so this is asserted against first paint too.
    await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('varve-theme', 'system'));
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');

    // An explicit preference wins over the OS request.
    await page.evaluate(() => localStorage.setItem('varve-theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // While on System, a live OS contrast change is followed without a
    // reload (the themeRuntime media listeners).
    await page.evaluate(() => localStorage.setItem('varve-theme', 'system'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
    await page.emulateMedia({ contrast: 'no-preference' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('storage changes synchronize another application window', async ({ context, page }) => {
    await page.goto('/');
    const auxiliary = await context.newPage();
    await auxiliary.goto('/');

    await page.evaluate(() => localStorage.setItem('varve-theme', 'dark'));
    await expect(auxiliary.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
    await expect(auxiliary.locator('html')).toHaveAttribute('data-theme', 'dark');
    await auxiliary.close();
  });
});
