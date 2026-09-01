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
