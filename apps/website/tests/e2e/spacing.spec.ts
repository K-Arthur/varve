import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/docs', '/download'] as const;

test.describe('shared spacing contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('varve-theme', 'light');
      window.localStorage.setItem('varve:website-analytics-consent', 'denied');
    });
  });

  for (const viewport of [
    { name: 'mobile', width: 320, height: 568 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    test(`${viewport.name} routes keep the page gutter and avoid horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.locator('.container-custom').first()).toBeVisible();

        const metrics = await page.evaluate(() => {
          const container = document.querySelector<HTMLElement>('.container-custom');
          if (!container) throw new Error('missing shared container');
          const styles = getComputedStyle(container);
          return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            gutter: Number.parseFloat(styles.paddingInlineStart),
            leftEdge: container.getBoundingClientRect().left,
          };
        });

        expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
        expect(metrics.leftEdge).toBeGreaterThanOrEqual(-1);
        expect(metrics.gutter).toBeGreaterThanOrEqual(viewport.name === 'mobile' ? 15 : 23);
        expect(metrics.gutter).toBeLessThanOrEqual(24.5);
      }
    });
  }
});
