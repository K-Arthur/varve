import { expect, test } from '@playwright/test';

/**
 * Asset and base-path integrity for both deployment modes.
 *
 * Every stylesheet, script, image and favicon referenced by the rendered
 * pages must resolve without a 404 — a missing stylesheet under a bad base
 * path shows up as a color/typography failure, so it is asserted directly.
 */

const ROUTES = ['/', '/product', '/download', '/docs', '/features', '/releases', '/about', '/404'];

test('all local assets referenced by pages resolve without 404', async ({ page, request }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    const assets = await page.evaluate(() => {
      const urls = new Set<string>();
      for (const el of document.querySelectorAll(
        'link[href], script[src], img[src], source[srcset]',
      )) {
        const href = el.getAttribute('href') ?? el.getAttribute('src');
        if (href?.startsWith('/')) urls.add(href);
      }
      return [...urls];
    });
    for (const asset of assets) {
      const res = await request.get(asset);
      expect(res.status(), `${route}: ${asset} -> ${res.status()}`).toBe(200);
    }
  }
});

test('known routes return 200 and unknown routes return the 404 page', async ({
  page,
  request,
}) => {
  for (const route of [
    '/',
    '/product',
    '/features',
    '/download',
    '/docs',
    '/support',
    '/contribute',
    '/learn',
    '/about',
  ]) {
    const res = await request.get(route);
    expect(res.status(), `${route}`).toBe(200);
  }
  const missing = await request.get('/definitely-not-a-page');
  expect(missing.status()).toBe(404);
  await page.goto('/definitely-not-a-page');
  await expect(page).toHaveTitle(/404|not found/i);
});
