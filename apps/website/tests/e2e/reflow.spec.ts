import { expect, test } from '@playwright/test';

/**
 * Page-level reflow corpus for the marketing surface. This deliberately tests
 * the widths between the named breakpoints as well as the common device sizes;
 * component-level scroll areas (code samples and dense tables) may scroll
 * internally, but the document itself must not widen past the viewport.
 */
const WIDTHS = [320, 375, 430, 480, 600, 768, 900, 1280, 1920];
const ROUTES = ['/', '/download', '/docs', '/features', '/support/faq'];

test('main content reflows without page-level horizontal overflow', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of ROUTES) {
      await page.goto(route);
      const metrics = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('#main-content');
        const mainRect = main?.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          mainLeft: mainRect?.left ?? -1,
          mainRight: mainRect?.right ?? Number.POSITIVE_INFINITY,
        };
      });
      expect(
        metrics.documentWidth,
        `${route} widens the page by ${metrics.documentWidth - metrics.viewportWidth}px at ${width}px`,
      ).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(
        metrics.mainLeft,
        `${route} starts outside the viewport at ${width}px`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        metrics.mainRight,
        `${route} ends outside the viewport at ${width}px`,
      ).toBeLessThanOrEqual(metrics.viewportWidth);
    }
  }
});
