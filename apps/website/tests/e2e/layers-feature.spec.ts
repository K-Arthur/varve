import { expect, test } from '@playwright/test';

test('Layers feature page communicates the supported handoff and stays within the viewport', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.localStorage.setItem('varve-theme', 'light');
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
  await page.goto('/features/layers');

  await expect(
    page.getByRole('heading', { name: 'Move ideas without losing the structure.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Place a selection without flattening it.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Read the Layers drag-and-drop contract/ }),
  ).toHaveAttribute('href', /layers-drag-drop\.md$/);

  const bounds = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflow: getComputedStyle(document.documentElement).overflowX,
  }));
  expect(
    bounds.documentWidth,
    'marketing page must not introduce horizontal overflow',
  ).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.overflow).not.toBe('hidden');

  await page.screenshot({
    path: testInfo.outputPath('layers-feature-light.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
