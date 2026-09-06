import { expect, test } from '@playwright/test';

test('Gradient Maps page communicates the editable tonal workflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/features/gradient-maps');

  await expect(
    page.getByRole('heading', { name: 'Change the mood without flattening the work.' }),
  ).toBeVisible();
  await expect(page.getByText(/Thirty starting points/i)).toBeVisible();
  await expect(page.getByText(/import Photoshop \.grd files/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clear boundaries.' })).toBeVisible();

  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

  await page.screenshot({
    path: testInfo.outputPath('gradient-maps-feature-light.png'),
    fullPage: true,
  });
});
