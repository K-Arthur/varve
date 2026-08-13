import { expect, test } from '@playwright/test';

test.describe('Object Selection marketing surface', () => {
  test('explains the local workflow and remains readable on mobile', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('/features/object-selection');
    await expect(page.getByRole('heading', { name: 'Object Selection', level: 1 })).toBeVisible();
    await expect(page.getByText(/From object to editable mask/i)).toBeVisible();
    await expect(page.getByText(/downloaded explicitly, verified before use/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set the right expectation' })).toBeVisible();

    await testInfo.attach('object-selection-feature-light', {
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
