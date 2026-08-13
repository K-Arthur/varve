import { expect, test } from '@playwright/test';

test('depth-aware effects page communicates the local-first workflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/features/depth-aware-effects');

  await expect(page.getByRole('heading', { name: 'Depth-aware effects' })).toBeVisible();
  await expect(page.getByText(/reusable relative DepthMap locally/i)).toBeVisible();
  await expect(page.getByText(/non-destructive/i).first()).toBeVisible();
  await expect(page.getByText(/not metric 3D/i)).toBeVisible();
  await expect(page).toHaveScreenshot('depth-aware-effects-feature-light.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
