import { expect, test } from '@playwright/test';

test.describe('Visual Awareness marketing surface', () => {
  test('labels the foundation honestly and remains readable on mobile', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('/features/visual-awareness');
    await expect(
      page.getByRole('heading', { name: "Visual awareness, on the designer's terms.", level: 1 }),
    ).toBeVisible();
    await expect(page.locator('.feature-kicker .status-pill')).toBeVisible();
    await expect(page.getByText(/Images are not uploaded for these workflows/i)).toBeVisible();
    await expect(
      page.locator('.link-grid').getByRole('link', { name: /Object Selection/ }),
    ).toBeVisible();

    await testInfo.attach('visual-awareness-feature-light', {
      body: await page.locator('.feature-page').screenshot(),
      contentType: 'image/png',
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const layout = await page.locator('.feature-page').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  });
});
