import { expect, test } from '@playwright/test';

test('image treatments explains constrained previews and preserves mobile reflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/features/image-treatments');

  await expect(
    page.getByRole('heading', { name: 'Texture, depth, and finish without flattening the work.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A lighter preview is still an honest edit.' }),
  ).toBeVisible();
  await expect(page.getByText(/active sliders and navigation take priority/i)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Read how performance modes work/i }),
  ).toHaveAttribute('href', /\/docs\/performance$/);

  const desktopLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(desktopLayout.documentWidth).toBeLessThanOrEqual(desktopLayout.viewportWidth + 1);
  await page.screenshot({
    path: testInfo.outputPath('image-treatments-desktop-light.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.locator('.feature-page').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  await page.screenshot({
    path: testInfo.outputPath('image-treatments-mobile-light.png'),
    fullPage: true,
  });
});
