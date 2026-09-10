import { expect, test } from '@playwright/test';

test('development workflow page communicates exact-source validation', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/docs/development-workflow');

  await expect(page).toHaveTitle(/Development Workflow/);
  await expect(page.getByRole('heading', { name: 'Evidence that follows the work' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Commit locally. Certify remotely. Publish deliberately.' }),
  ).toBeVisible();
  await expect(page.locator('pre code')).toContainText('pnpm verify:affected');
  await expect(page.getByText('A green local hook is not a published release')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();

  const metrics = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
  await page.screenshot({
    path: testInfo.outputPath('development-workflow-page.png'),
    fullPage: true,
  });
});
