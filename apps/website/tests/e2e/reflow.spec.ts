import { expect, test } from '@playwright/test';

/**
 * Page-level reflow corpus for the marketing surface. This deliberately tests
 * the widths between the named breakpoints as well as the common device sizes;
 * component-level scroll areas (code samples and dense tables) may scroll
 * internally, but the document itself must not widen past the viewport.
 */
const WIDTHS = [320, 375, 430, 480, 600, 768, 900, 1280, 1920];
const ROUTES = ['/', '/download', '/docs', '/features', '/support/faq', '/accessibility'];

test('main content reflows without page-level horizontal overflow', async ({ page }) => {
  test.setTimeout(120_000); // 54 route/viewport visits exceed the default under shared load.
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

for (const theme of ['light', 'dark'] as const) {
  test(`homepage facts remain readable immediately after enlarging text (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((value) => {
      localStorage.setItem('varve-theme', value);
      localStorage.setItem('varve:website-analytics-consent', 'denied');
    }, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?test-motion=static');
    await page.evaluate(() => document.fonts.ready);
    for (const width of [320, 375, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
        // Measure in this task: the original overflow disappeared on a later
        // frame and a wait would conceal the intrinsic grid sizing defect.
        const documentWidth = document.documentElement.scrollWidth;
        const overflow =
          documentWidth > window.innerWidth + 1
            ? [...document.body.querySelectorAll<HTMLElement>('*')]
                .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
                .slice(0, 75)
                .map((node) => ({
                  element: `${node.tagName}.${[...node.classList].join('.')}`,
                  right: node.getBoundingClientRect().right,
                  text: node.textContent?.trim().slice(0, 80),
                  overflowX: getComputedStyle(node).overflowX,
                  transition: getComputedStyle(node).transition,
                  parent: node.parentElement
                    ? {
                        element: node.parentElement.className,
                        right: node.parentElement.getBoundingClientRect().right,
                        overflowX: getComputedStyle(node.parentElement).overflowX,
                      }
                    : null,
                }))
            : [];
        return {
          viewport: window.innerWidth,
          documentWidth,
          overflow,
          facts: [...document.querySelectorAll<HTMLElement>('.trust-item')].map((item) => {
            const bounds = item.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              width: bounds.width,
              scrollWidth: item.scrollWidth,
              clientWidth: item.clientWidth,
              text: item.textContent?.trim(),
            };
          }),
        };
      });
      await test.info().attach(`immediate-homepage-text-${width}-${theme}`, {
        body: JSON.stringify(metrics, null, 2),
        contentType: 'application/json',
      });
      expect(metrics.documentWidth, `page after 200% text at ${width}px`).toBeLessThanOrEqual(
        metrics.viewport + 1,
      );
      expect(metrics.facts).toHaveLength(4);
      for (const fact of metrics.facts) {
        expect(fact.width, fact.text).toBeGreaterThan(0);
        expect(fact.left, fact.text).toBeGreaterThanOrEqual(15);
        expect(fact.right, fact.text).toBeLessThanOrEqual(metrics.viewport - 15);
        expect(fact.scrollWidth, fact.text).toBeLessThanOrEqual(fact.clientWidth + 1);
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
    }
  });
}
