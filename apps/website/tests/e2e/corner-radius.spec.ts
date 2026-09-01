import { expect, test } from '@playwright/test';

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
          primaryButton: read('.hero .btn-primary'),
        };
      });

      expect(homeGeometry).toEqual({
        primaryButton: '6px',
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
        card: '16px',
        control: '6px',
        pill: '9999px',
      });

      await page.screenshot({
        path: `test-results/corner-radius-download-${theme}.png`,
        fullPage: false,
      });
    });
  }
});
