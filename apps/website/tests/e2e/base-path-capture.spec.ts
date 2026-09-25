/** Review artifacts for both supported site base paths and both themes. */
import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of ['desktop', 'mobile'] as const) {
    test(`${viewport} ${theme} homepage renders under the configured base path`, async ({
      page,
      baseURL,
    }, testInfo) => {
      if (!baseURL) throw new Error('Website baseURL is required');
      await page.setViewportSize(
        viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 375, height: 812 },
      );
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript((value) => {
        localStorage.setItem('varve-theme', value);
        localStorage.setItem('varve:website-analytics-consent', 'denied');
      }, theme);
      const expectedBase = new URL(baseURL).pathname.replace(/\/$/, '') || '/';
      const target = new URL(baseURL);
      target.pathname = expectedBase === '/' ? '/' : `${expectedBase}/`;
      target.search = '?test-motion=static';
      await page.goto(target.toString());
      expect(new URL(page.url()).pathname).toBe(target.pathname);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Design locally.');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('One canvas.');
      await expect(page.locator('.hero-subtitle')).toContainText('no account, no subscription');
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        window.scrollTo(0, 0);
        await Promise.all(
          [...document.images].map(async (image) => {
            if (!image.complete)
              await new Promise((resolve) =>
                image.addEventListener('load', resolve, { once: true }),
              );
            await image.decode().catch(() => undefined);
          }),
        );
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`home-${viewport}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
}
