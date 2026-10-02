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
        for (const image of document.images) image.loading = 'eager';
        const pendingImages = [...document.images].filter((image) => !image.complete);
        await Promise.all(
          pendingImages.map(
            (image) =>
              new Promise<void>((resolve) => {
                let timer: number | undefined;
                const finish = () => {
                  if (timer !== undefined) window.clearTimeout(timer);
                  resolve();
                };
                image.addEventListener('load', finish, { once: true });
                image.addEventListener('error', finish, { once: true });
                timer = window.setTimeout(finish, 15_000);
                if (image.complete) finish();
              }),
          ),
        );
        const brokenImages = [...document.images]
          .filter((image) => image.naturalWidth === 0)
          .map((image) => image.currentSrc || image.src);
        if (brokenImages.length > 0) {
          throw new Error(`Images failed before base-path capture: ${brokenImages.join(', ')}`);
        }
        await Promise.all(
          [...document.images].map((image) => image.decode().catch(() => undefined)),
        );
        window.scrollTo(0, 0);
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
