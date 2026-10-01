import { expect, test } from '@playwright/test';

function route(baseURL: string | undefined, path: string): string {
  if (!baseURL) throw new Error('Website baseURL is required');
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  return new URL(path.replace(/^\//, ''), base).toString();
}

test('feature and guide are searchable and linked under both site base paths', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(route(baseURL, 'features'));
  await page.getByRole('link', { name: 'Presentation authoring in Design' }).click();
  await expect(page).toHaveURL(/\/features\/presentations$/);
  await expect(page.locator('.status-pill-experimental')).toContainText(
    /Source-build preview|Experimental · v\d+\.\d+\.\d+/,
  );
  await expect(
    page.getByRole('heading', { name: 'Presentation authoring in Design' }),
  ).toBeVisible();
  const screenshots = page.locator('.presentation-visuals picture.screenshot-image img');
  await expect(screenshots).toHaveCount(5);
  for (const screenshot of await screenshots.all()) {
    await screenshot.scrollIntoViewIfNeeded();
    await expect
      .poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect(page.getByRole('link', { name: 'Read the presentation guide' })).toHaveAttribute(
    'href',
    /\/docs\/presentations$/,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('presentations-feature-desktop-light.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.locator('.nav-search-trigger').click();
  await page.locator('[data-search-input]').fill('presentation authoring');
  const result = page.locator('[data-search-results] [role="option"]');
  const presentationResult = result.filter({ hasText: 'Presentation authoring' }).first();
  await expect(presentationResult).toBeVisible();
  await expect(presentationResult.locator('.search-result__path')).toContainText('presentations');
});

test('presentation guide remains readable in dark theme at mobile width', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('varve-theme', 'dark');
    localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
  await page.goto(route(baseURL, 'docs/presentations'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Presentation authoring' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export & Code Generation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'presentation feature status' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('presentations-guide-mobile-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
