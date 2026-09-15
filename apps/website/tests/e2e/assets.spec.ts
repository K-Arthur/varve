import { expect, test } from '@playwright/test';

/**
 * Asset and base-path integrity for both deployment modes.
 *
 * Every stylesheet, script, image and favicon referenced by the rendered
 * pages must resolve without a 404 — a missing stylesheet under a bad base
 * path shows up as a color/typography failure, so it is asserted directly.
 */

const ROUTES = [
  '/',
  '/product',
  '/download',
  '/docs',
  '/docs/chromebook',
  '/docs/performance',
  '/docs/touch-and-pen',
  '/support/troubleshooting',
  '/features',
  '/releases',
  '/about',
  '/accessibility',
  '/404',
];

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

test('stage 6 docs copy never glues a link to the preceding word', async ({ page }) => {
  // Astro collapses the newline before an inline <a> in JSX-like templates,
  // which renders "inVarve" instead of "in Varve". A rendered-text check is
  // the only reliable detector: the source line break looks correct. Scope:
  // the pages this stage owns; a sitewide audit found the same pre-existing
  // spacing defect on contact/press/legal pages and is recorded separately.
  const textRoutes = [
    '/download',
    '/docs',
    '/docs/chromebook',
    '/docs/performance',
    '/docs/touch-and-pen',
    '/docs/browser-demo',
    '/docs/chromeos-linux',
    '/docs/getting-started',
    '/support/faq',
    '/support/troubleshooting',
    '/releases',
    '/about',
    '/accessibility',
  ];
  for (const route of textRoutes) {
    await page.goto(route);
    const glued = await page.evaluate(() => {
      const out: string[] = [];
      for (const anchor of document.querySelectorAll('a')) {
        const previous = anchor.previousSibling;
        if (
          previous?.nodeType === Node.TEXT_NODE &&
          /[A-Za-z0-9]$/.test(previous.textContent ?? '')
        ) {
          out.push(`${(previous.textContent ?? '').slice(-20)}|${anchor.textContent ?? ''}`);
        }
      }
      return out;
    });
    expect(glued, `${route}: ${glued.join(', ')}`).toEqual([]);
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
    '/docs/chromebook',
    '/docs/performance',
    '/docs/touch-and-pen',
    '/support',
    '/support/troubleshooting',
    '/contribute',
    '/learn',
    '/about',
    '/accessibility',
  ]) {
    const res = await request.get(route);
    expect(res.status(), `${route}`).toBe(200);
  }
  const missing = await request.get('/definitely-not-a-page');
  expect(missing.status()).toBe(404);
  await page.goto('/definitely-not-a-page');
  await expect(page).toHaveTitle(/404|not found/i);
});
