import { expect, test } from '@playwright/test';

test.describe('canvas feature page', () => {
  test('explains the responsive rendering contract and reflows on mobile', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/features/canvas');
    const contract = page.getByTestId('canvas-responsiveness-contract');
    await expect(contract).toBeVisible();
    await expect(contract).toContainText('Stable coordinates');
    await expect(contract).toContainText('Honest rendering');
    await expect(contract.locator('article')).toHaveCount(3);
    const labels = page.getByTestId('canvas-label-scope');
    await expect(labels).toBeVisible();
    await expect(labels).toContainText('Labels follow the surface');
    await expect(labels).toContainText('do not become document nodes');
    await page.screenshot({
      path: testInfo.outputPath('canvas-feature-desktop.png'),
      fullPage: false,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(contract).toBeVisible();
    await expect(contract.locator('article')).toHaveCount(3);
    const mobileMetrics = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      cards: [...document.querySelectorAll<HTMLElement>('.responsive-contract__grid article')].map(
        (card) => card.getBoundingClientRect().width,
      ),
    }));
    expect(mobileMetrics.documentWidth).toBeLessThanOrEqual(mobileMetrics.viewportWidth);
    expect(mobileMetrics.cards[0]).toBeGreaterThan(250);
    await page.screenshot({
      path: testInfo.outputPath('canvas-feature-mobile.png'),
      fullPage: true,
    });
  });
});
