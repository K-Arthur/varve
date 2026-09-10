import { expect, test } from '@playwright/test';

const layouts = [
  { name: 'desktop-light', theme: 'light', width: 1280, height: 900 },
  { name: 'desktop-dark', theme: 'dark', width: 1280, height: 900 },
  { name: 'narrow-dark', theme: 'dark', width: 390, height: 844 },
] as const;

for (const route of ['/features/typography', '/docs/tools/typography']) {
  for (const layout of layouts) {
    test(`${route} ${layout.name} keeps typography guidance readable`, async ({
      page,
      baseURL,
    }, testInfo) => {
      if (!baseURL) throw new Error('Website base URL is required');
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.emulateMedia({ colorScheme: layout.theme, reducedMotion: 'reduce' });
      await page.addInitScript((theme) => {
        localStorage.setItem('varve-theme', theme);
        localStorage.setItem('varve:website-analytics-consent', 'denied');
      }, layout.theme);
      const response = await page.goto(`${baseURL.replace(/\/$/, '')}${route}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Typography', exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        layout.width,
      );
      const content = page.locator('.feature-page, .docs-page');
      await expect(content).toContainText('More text formatting');
      await expect(content).toContainText('Select by Font');
      await expect(content).toContainText('still being integrated');
      await page.screenshot({ path: testInfo.outputPath('typography-intro.png') });
      const details = page.getByRole('heading', {
        name: route.startsWith('/features')
          ? 'Current font workflow limits'
          : 'Font access and licensing',
      });
      await details.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('typography-font-access.png') });
      const brokenImages = await content.locator('img').evaluateAll(async (images) => {
        await Promise.all(
          images.map((element) => {
            const image = element as HTMLImageElement;
            image.loading = 'eager';
            return image.decode().catch(() => undefined);
          }),
        );
        return images
          .filter((image) => !(image as HTMLImageElement).naturalWidth)
          .map((image) => image.getAttribute('src'));
      });
      expect(brokenImages).toEqual([]);
      if (route.startsWith('/features')) {
        await expect(content).toContainText('See the typography guide for the available controls');
        const toolbar = content.locator('img[src$="font-toolbar-light.png"]');
        await toolbar.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('typography-toolbar-scene.png') });
        const browser = content.locator('img[src$="font-browser-light.png"]');
        await browser.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('typography-browser-scene.png') });
      }
    });
  }
}

test('font FAQ structured data matches visible limitations', async ({ page, baseURL }) => {
  await page.goto(`${baseURL?.replace(/\/$/, '')}/features/typography`);
  const faq = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts
        .map((script) => JSON.parse(script.textContent ?? '{}'))
        .find((value) => value['@type'] === 'FAQPage'),
    );
  expect(faq.mainEntity[0].acceptedAnswer.text).toContain('matching Fontsource family and style');
  expect(JSON.stringify(faq)).not.toContain('exact specimen');
  await expect(page.locator('.feature-faq')).toContainText(
    'A family name alone cannot identify the original font file or revision.',
  );
});
