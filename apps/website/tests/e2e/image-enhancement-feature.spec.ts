import { expect, test } from '@playwright/test';

test('image enhancement feature page explains the shipped workflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/features/image-enhancement');

  await expect(
    page.getByRole('heading', { name: /enhance images without leaving the canvas/i }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Denoise' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deblur' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Restore + Upscale' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Auto / Recommended' })).toBeVisible();
  // Honest boundary: JPEG artifact removal stays unadvertised.
  await expect(page.getByText(/JPEG artifact removal is not offered/i)).toBeVisible();
  await expect(page.locator('.pipeline')).toBeVisible();
});

test('image enhancement documentation is linked and readable', async ({ page }) => {
  await page.goto('/docs/tools/image-enhancement');
  await expect(page.getByRole('heading', { name: 'Image Enhance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Honest capabilities' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose the task' })).toBeVisible();
});
