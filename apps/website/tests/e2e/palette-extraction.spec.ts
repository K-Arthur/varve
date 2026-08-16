import { expect, test } from '@playwright/test';

test.describe('palette extraction marketing surface', () => {
  test('explains the local workflow and remains readable on mobile', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('/features/color-effects');

    await expect(
      page.getByRole('heading', { name: 'From Image to Working Palette' }),
    ).toBeVisible();
    await expect(page.getByText(/bounded preview is analysed locally/i)).toBeVisible();
    await expect(page.getByText(/Generated harmonies/i)).toBeVisible();
    await expect(page.getByText(/WCAG 2.1 body-text and large-text contrast/i)).toBeVisible();
    const paletteVisual = page.locator('.feature-visual img');
    await expect(paletteVisual).toBeVisible();
    await expect(paletteVisual).toHaveAttribute('alt', /extracted swatches/i);

    await testInfo.attach('palette-feature-light', {
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
