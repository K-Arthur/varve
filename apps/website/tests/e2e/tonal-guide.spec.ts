import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('tonal feature links to a readable, honest guide with real editor images', async ({
  page,
  baseURL,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('varve:website-analytics-consent', 'denied'));
  await page.goto(`${baseURL?.replace(/\/$/, '')}/features/color-effects`);
  const link = page.getByRole('link', { name: 'Read the tonal editing guide', exact: true });
  const response = await page.request.get((await link.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  await link.click();
  await expect(
    page.getByRole('heading', { name: 'Channels and Tonal Editing', level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.docs-page')).toContainText('It is not measured Kelvin');
  await expect(page.locator('.docs-page')).toContainText('straight-alpha RGBA8');
  const evidence = path.resolve('reports/ui-review/tonal-website');
  mkdirSync(evidence, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: path.join(evidence, `${info.project.name}-${theme}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: path.join(evidence, `${info.project.name}-${theme}-mobile-top.png`),
    });
    await page.screenshot({
      path: path.join(evidence, `${info.project.name}-${theme}-mobile.png`),
      fullPage: true,
    });
  }
  const examples = page.locator('.tonal-example img');
  await expect(examples).toHaveCount(2);
  for (const image of await examples.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBe(1280);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.getByRole('heading', { name: 'Save and compare' })).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, `${info.project.name}-forced-colors.png`),
    fullPage: true,
  });
});
