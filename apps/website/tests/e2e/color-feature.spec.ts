import { expect, test } from '@playwright/test';

test.describe('color feature messaging', () => {
  test('explains native document color, working precision, and preview limits', async ({
    page,
  }) => {
    await page.goto('/features/color-effects');

    await expect(page.getByRole('heading', { name: 'Color & Effects', level: 1 })).toBeVisible();
    await expect(page.getByText(/CMYK values remain native document values/i)).toBeVisible();
    await expect(page.getByText(/16-bit integer and floating-point channel values/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Print Preview, Honestly' })).toBeVisible();
    await expect(
      page.getByText(/browser previews use the browser's sRGB display path/i),
    ).toBeVisible();
    await expect(page.getByText(/high-precision raster decode, CMYK raster planes/i)).toBeVisible();
  });
});
