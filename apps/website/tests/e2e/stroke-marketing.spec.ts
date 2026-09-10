import { expect, test } from '@playwright/test';

test.describe('Stroke System marketing pages', () => {
  for (const route of ['/features/strokes', '/docs/tools/strokes']) {
    test(`${route} renders its stroke guidance`, async ({ page }, testInfo) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main')).toContainText(/stroke/i);
      await expect(page.locator('a[href*="/docs/tools/strokes"]')).toHaveCount(
        route === '/features/strokes' ? 2 : 0,
      );
      await page.locator('main').screenshot({ path: testInfo.outputPath('stroke-page.png') });
    });
  }
});
