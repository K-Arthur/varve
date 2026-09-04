import { readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

function discoverStaticRoutes(directory: string, prefix = ''): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      routes.push(...discoverStaticRoutes(entryPath, `${prefix}/${entry.name}`));
    } else if (entry.name === 'index.html') {
      routes.push(prefix || '/');
    } else if (entry.name.endsWith('.html')) {
      routes.push(`${prefix}/${entry.name}`);
    }
  }
  return routes.sort();
}

const staticRoutes = discoverStaticRoutes(path.resolve('apps/website/dist-pages'));

async function seedTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem('varve-theme', value);
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  }, theme);
}

test.describe('corner radius system', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme} geometry and screenshot`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await seedTheme(page, theme);
      await page.goto('/');
      await expect(page.locator('.hero-title')).toBeVisible();

      const homeGeometry = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          return element ? getComputedStyle(element).borderRadius : null;
        };
        return {
          primaryButton: read('.hero .btn-default'),
          navDownload: read('.nav-download-cta'),
          navTry: read('.nav-try-cta'),
        };
      });

      expect(homeGeometry).toEqual({
        primaryButton: '8px',
        navDownload: '8px',
        navTry: '8px',
      });

      await page.screenshot({
        path: `test-results/corner-radius-home-${theme}.png`,
        fullPage: false,
      });

      await page.goto('/download');
      await expect(page.locator('.quick-download')).toBeVisible();

      const downloadGeometry = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          return element ? getComputedStyle(element).borderRadius : null;
        };
        return {
          card: read('.quick-download'),
          control: read('.quick-download-btn'),
          pill: read('.architecture-badge'),
        };
      });

      expect(downloadGeometry).toEqual({
        card: '18px',
        control: '8px',
        pill: '9999px',
      });

      await page.screenshot({
        path: `test-results/corner-radius-download-${theme}.png`,
        fullPage: false,
      });
    });
  }

  test('all static-page buttons use the shared control geometry', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await seedTheme(page, 'light');

    for (const route of staticRoutes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const violations = await page.evaluate(() => {
        const controls = [
          ...document.querySelectorAll<HTMLElement>('.btn:not(.btn-pill):not(.btn-pill-outline)'),
          ...document.querySelectorAll<HTMLElement>('.nav-try-cta'),
          ...document.querySelectorAll<HTMLElement>('.nav-download-cta'),
        ];
        return controls
          .filter((element) => getComputedStyle(element).borderRadius !== '8px')
          .map((element) => ({
            className: element.className,
            radius: getComputedStyle(element).borderRadius,
          }));
      });

      expect(violations, `Unexpected button geometry on ${route}`).toEqual([]);
    }
  });
});
