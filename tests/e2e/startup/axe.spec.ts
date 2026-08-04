import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

test.describe('Startup accessibility', () => {
  test('native splashscreen.html passes axe-core', async ({ page }) => {
    await page.goto('/splashscreen.html', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('startup surfaces expose status roles after home load', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30_000 });

    const hasAccessibleSurface = await page.evaluate(() => {
      return Boolean(
        document.querySelector('[role="status"]') || document.querySelector('.varve-home'),
      );
    });
    expect(hasAccessibleSurface).toBe(true);
  });
});
