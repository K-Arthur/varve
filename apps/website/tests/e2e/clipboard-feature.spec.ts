import { expect, test } from '@playwright/test';

test('clipboard feature page describes structure-preserving transfer', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/features/clipboard');

  await expect(page).toHaveTitle(/reliable clipboard/i);
  await expect(page.getByRole('heading', { name: /copy should mean more than/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Editable layer fragments' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cut waits for truth' })).toBeVisible();
  await expect(page.getByText(/does not claim Figma, Illustrator, or Office/i)).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`clipboard feature desktop ${colorScheme} layout`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/features/clipboard');
    await expect(
      page.getByRole('heading', { name: /what travels, and what stays honest/i }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`clipboard-feature-desktop-${colorScheme}.png`),
      fullPage: true,
    });
  });
}

test('clipboard feature page remains usable at mobile width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/features/clipboard');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('link', { name: /download varve/i })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('clipboard-feature-mobile.png'),
    fullPage: true,
  });
});
