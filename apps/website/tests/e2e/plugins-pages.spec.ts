import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 375, height: 812 },
] as const;

test('plugin feature and guide render without broken images or horizontal overflow', async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(45000);
  if (!baseURL) throw new Error('Website baseURL is required');
  const basePath = new URL(baseURL).pathname.replace(/\/$/, '');
  const featureUrl = new URL(`${basePath}/features/plugins`, baseURL).toString();
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(featureUrl);
    await expect(page).toHaveURL(new RegExp(`${basePath}/features/plugins$`));
    await expect(
      page.getByRole('heading', { name: 'Useful extensions, with the document in your hands.' }),
    ).toBeVisible();
    await page.locator('.actions').scrollIntoViewIfNeeded();
    const images = page.locator('.product-capture img');
    await expect(images).toHaveCount(4);
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLImageElement>('.product-capture img')].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    const featureState = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      screenshotPaths: [...document.querySelectorAll('.product-capture img')].map(
        (image) => new URL((image as HTMLImageElement).currentSrc).pathname,
      ),
    }));
    expect(featureState.document).toBeLessThanOrEqual(featureState.viewport + 1);
    expect(featureState.screenshotPaths).toHaveLength(4);
    for (const screenshotPath of featureState.screenshotPaths) {
      expect(screenshotPath).toContain('/screenshots/');
      if (baseURL?.includes('/varve')) expect(screenshotPath).toMatch(/^\/varve\/screenshots\//);
    }
    // The lazy-image wait scrolled the sticky site header into the middle of a
    // full-page capture. Restore the true page-top visual before capturing.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY === 0);
    await page.screenshot({
      path: testInfo.outputPath(`plugin-feature-${viewport.name}.png`),
      fullPage: true,
    });

    await page.getByRole('link', { name: 'Installation and developer guide' }).click();
    await expect(page).toHaveURL(/\/docs\/plugins\/?$/);
    await expect(page.getByRole('heading', { name: 'Local plugins' })).toBeVisible();
    const guideWidth = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(guideWidth.document).toBeLessThanOrEqual(guideWidth.viewport + 1);
    await page.screenshot({
      path: testInfo.outputPath(`plugin-guide-${viewport.name}.png`),
      fullPage: true,
    });
  }
});
