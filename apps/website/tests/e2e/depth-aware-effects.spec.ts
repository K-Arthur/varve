import { expect, test } from '@playwright/test';

test.describe('depth-aware masking marketing workflow', () => {
  test('explains the reusable mask path and stays readable on a narrow viewport', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/features/depth-aware-effects');
    const feature = page.locator('.feature-page');
    await expect(feature).toContainText('reusable relative DepthMap');
    await expect(feature).toContainText('Depth Mask surface');
    await expect(feature).toContainText('existing raster masks');
    await expect(feature).toContainText('relative, not calibrated metres');
    await expect(feature.locator('a[href*="/docs/tools/depth-blur"]')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('depth-aware-effects-feature-desktop.png'),
      fullPage: true,
    });

    await page.goto('/docs/tools/depth-blur');
    const docs = page.locator('.doc-page');
    await expect(docs).toContainText('Adjustments → Depth Mask');
    await expect(docs).toContainText('Sample near');
    await expect(docs).toContainText('model being installed');
    await expect(docs).toContainText('arbitrary grayscale PNG');
    await page.screenshot({
      path: testInfo.outputPath('depth-aware-effects-docs-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth);
    await page.screenshot({
      path: testInfo.outputPath('depth-aware-effects-docs-mobile.png'),
      fullPage: true,
    });
  });
});
