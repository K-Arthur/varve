import { expect, test } from '@playwright/test';

test.describe('Font provider marketing copy', () => {
  test('local-first page explains offline catalog discovery and explicit installs', async ({
    page,
  }) => {
    await page.goto('/features/local-first');
    const featurePage = page.locator('.feature-page');
    await expect(featurePage).toContainText('shipped Fontsource catalog offline');
    await expect(featurePage).toContainText('explicit desktop install');
    await page.screenshot({
      path: test.info().outputPath('local-first-font-catalog.png'),
      fullPage: true,
    });
  });

  test('typography page explains the keyless, pinned installation flow', async ({ page }) => {
    await page.goto('/features/typography');
    const featurePage = page.locator('.feature-page');
    await expect(featurePage).toContainText('does not require a Google Fonts key');
    await expect(featurePage).toContainText('version-pinned Fontsource artifact');
    await expect(featurePage).toContainText('requested Fontsource face');
    await expect(featurePage).toContainText('requested weight, style, and license');
    await page.screenshot({
      path: test.info().outputPath('typography-fontsource-flow.png'),
      fullPage: true,
    });
  });
});
