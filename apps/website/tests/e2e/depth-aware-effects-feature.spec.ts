import { expect, test } from '@playwright/test';

test('depth-aware effects page communicates the local-first workflow', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/features/depth-aware-effects');

  await expect(page.getByRole('heading', { name: 'Depth-aware effects' })).toBeVisible();
  await expect(page.getByText(/reusable relative DepthMap locally/i)).toBeVisible();
  await expect(page.getByText(/non-destructive/i).first()).toBeVisible();
  await expect(page.getByText(/relative depth, not calibrated camera distance/i)).toBeVisible();
  await expect(page).toHaveScreenshot('depth-aware-effects-feature-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    timeout: 60000,
  });
});

test('depth blur docs page covers generation, masks, and regeneration', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/docs/tools/depth-blur');

  await expect(page.getByRole('heading', { name: 'Depth Blur' })).toBeVisible();
  await expect(page.getByText(/Depth Range Mask/i)).toBeVisible();
  await expect(page.getByText(/regenerate depth map/i).first()).toBeVisible();
  await expect(page.getByText(/relative, not metric/i)).toBeVisible();
});
