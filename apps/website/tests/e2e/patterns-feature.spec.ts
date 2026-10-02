import { expect, test } from '@playwright/test';

function route(baseURL: string | undefined, path: string): string {
  if (!baseURL) throw new Error('Website baseURL is required');
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  return new URL(path.replace(/^\//, ''), base).toString();
}

test('pattern feature shows the real workflow capture and fits a phone viewport', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(route(baseURL, 'features/patterns'));

  await expect(
    page.getByRole('heading', { name: 'Make a repeat once. Place it where the design needs it.' }),
  ).toBeVisible();
  await expect(page.locator('.status-pill-experimental')).toContainText(
    /Source-build preview|Experimental · v\d+\.\d+\.\d+/,
  );
  await expect(page.getByText('Current boundaries')).toBeVisible();
  const image = page.getByRole('img', {
    name: /reusable dotted vector pattern applied to a selected shape/i,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({
    path: testInfo.outputPath('patterns-feature-desktop-light.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route(baseURL, 'features/patterns'));
  await expect(image).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'patterns page mobile overflow').toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('patterns-feature-mobile-light.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
