import { expect, test } from '@playwright/test';

/**
 * SEO / discovery contract for every rendered page, in both deployment modes.
 *
 * This is the durable half of the discovery workstream: metadata that is not
 * asserted decays. It pins the pieces search engines and link unfurlers
 * actually read:
 *
 *   - every page has a title, description, robots directive, canonical,
 *     Open Graph and Twitter card tags;
 *   - canonical/og:url are absolute and consistent with each other and with
 *     the visited route, under either deployment origin (varve.studio or the
 *     legacy k-arthur.github.io/varve build);
 *   - sitewide Organization + WebSite JSON-LD on every page, plus the
 *     SoftwareApplication schema on the homepage;
 *   - the social card exists, is a PNG, and is exactly 1200x630;
 *   - robots.txt and sitemap.xml are generated, absolute, and enumerate the
 *     real pages while excluding 404 and alias routes;
 *   - the 404 page is noindex and carries no canonical.
 *
 * Assertions are origin- and base-agnostic so the same spec runs against the
 * ghpages and custom-domain builds.
 */

const KNOWN_ORIGINS = ['https://varve.studio', 'https://k-arthur.github.io'];

const ROUTES = [
  '/',
  '/product',
  '/features',
  '/download',
  '/docs',
  '/support',
  '/contribute',
  '/learn',
  '/about',
  '/press',
  '/releases',
  '/compare',
  '/security',
  '/support-project',
  '/features/local-first',
  '/features/print-production',
];

/** Routes that must never appear in the sitemap. */
const SITEMAP_EXCLUDED = ['/404', '/about/security'];

test('every page emits complete, consistent head metadata', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    const meta = await page.evaluate(() => {
      const get = (selector: string, attr = 'content') =>
        document.querySelector(selector)?.getAttribute(attr) ?? null;
      const ldJson = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .flatMap((el) => {
          try {
            return JSON.parse(el.textContent ?? '');
          } catch {
            return null;
          }
        })
        .filter((v): v is { '@type'?: string } => v !== null && typeof v === 'object');
      return {
        title: document.title,
        description: get('meta[name="description"]'),
        robots: get('meta[name="robots"]'),
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
        ogType: get('meta[property="og:type"]'),
        ogSiteName: get('meta[property="og:site_name"]'),
        ogUrl: get('meta[property="og:url"]'),
        ogTitle: get('meta[property="og:title"]'),
        ogDescription: get('meta[property="og:description"]'),
        ogImage: get('meta[property="og:image"]'),
        ogImageWidth: get('meta[property="og:image:width"]'),
        ogImageHeight: get('meta[property="og:image:height"]'),
        ogImageAlt: get('meta[property="og:image:alt"]'),
        ogLocale: get('meta[property="og:locale"]'),
        twitterCard: get('meta[name="twitter:card"]'),
        twitterTitle: get('meta[name="twitter:title"]'),
        twitterImage: get('meta[name="twitter:image"]'),
        twitterImageAlt: get('meta[name="twitter:image:alt"]'),
        ldTypes: ldJson.map((s) => s['@type']),
      };
    });

    expect(meta.title, `${route}: title`).toBeTruthy();
    expect(meta.title.length, `${route}: title length`).toBeLessThanOrEqual(70);
    if (!/\bVarve\b/.test(meta.title)) {
      expect(meta.title, `${route}: brand suffix`).toMatch(/\| Varve$/);
    }

    expect(meta.description, `${route}: description`).toBeTruthy();
    if (meta.description === null) {
      throw new Error(`${route}: description is missing`);
    }
    expect(meta.description.length, `${route}: description length`).toBeLessThanOrEqual(320);

    expect(meta.robots, `${route}: robots`).toBe('index, follow');
    expect(meta.canonical, `${route}: canonical`).not.toBeNull();

    const canonical = new URL(meta.canonical!);
    expect(KNOWN_ORIGINS, `${route}: canonical origin`).toContain(canonical.origin);
    // In the ghpages build the canonical carries a /varve base prefix that
    // the page URL does not, so check the canonical path ends with the route.
    const routePath = new URL(page.url()).pathname.replace(/\/+$/, '') || '/';
    const routeSuffix = routePath === '/' ? '/' : routePath;
    const canonicalPath = canonical.pathname;
    expect(
      canonicalPath.indexOf(routeSuffix) === canonicalPath.length - routeSuffix.length ||
        (routeSuffix === '/' && canonicalPath === `${canonicalPath.replace(/\/+$/, '')}/`),
      `${route}: canonical path ends with visited route`,
    ).toBe(true);

    expect(meta.ogUrl, `${route}: og:url`).toBe(meta.canonical);
    expect(meta.ogType, `${route}: og:type`).toBe('website');
    expect(meta.ogSiteName, `${route}: og:site_name`).toBe('Varve');
    expect(meta.ogTitle, `${route}: og:title`).toBe(meta.title);
    expect(meta.ogDescription, `${route}: og:description`).toBe(meta.description);
    expect(meta.ogImage, `${route}: og:image`).toBeTruthy();
    expect(KNOWN_ORIGINS, `${route}: og:image origin`).toContain(new URL(meta.ogImage!).origin);
    expect(meta.ogImageWidth, `${route}: og:image:width`).toBe('1200');
    expect(meta.ogImageHeight, `${route}: og:image:height`).toBe('630');
    expect(meta.ogImageAlt, `${route}: og:image:alt`).toMatch(/^Varve /);
    expect(meta.ogLocale, `${route}: og:locale`).toBe('en_US');

    expect(meta.twitterCard, `${route}: twitter:card`).toBe('summary_large_image');
    expect(meta.twitterTitle, `${route}: twitter:title`).toBe(meta.title);
    expect(meta.twitterImage, `${route}: twitter:image`).toBe(meta.ogImage);
    expect(meta.twitterImageAlt, `${route}: twitter:image:alt`).toBe(meta.ogImageAlt);

    // Sitewide Organization + WebSite on every page.
    for (const type of ['Organization', 'WebSite']) {
      expect(meta.ldTypes, `${route}: ld+json ${type}`).toContain(type);
    }
    if (route === '/') {
      expect(meta.ldTypes, `${route}: SoftwareApplication`).toContain('SoftwareApplication');
    }
  }
});

test('the social card exists and is exactly 1200x630', async ({ request }) => {
  const res = await request.get('/og-image.png');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/image\/png/);
  const body = await res.body();
  expect(body.subarray(1, 4).toString(), 'PNG magic').toBe('PNG');
  expect(body.readInt32BE(16), 'width').toBe(1200);
  expect(body.readInt32BE(20), 'height').toBe(630);
});

test('robots.txt allows crawling and points at the generated sitemap', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain('User-agent: *');
  expect(text).toContain('Allow: /');
  const sitemapLine = text.split('\n').find((line) => line.startsWith('Sitemap:'));
  expect(sitemapLine, 'Sitemap directive').toBeTruthy();
  const sitemapUrl = new URL(sitemapLine!.slice('Sitemap:'.length).trim());
  expect(KNOWN_ORIGINS).toContain(sitemapUrl.origin);
  expect(sitemapUrl.pathname).toMatch(/\/sitemap\.xml$/);
});

test('sitemap.xml enumerates every real page and excludes 404/alias/demo routes', async ({
  request,
}) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((url): url is string => typeof url === 'string');
  expect(urls.length, 'sitemap has entries').toBeGreaterThanOrEqual(ROUTES.length);

  for (const url of urls) {
    const u = new URL(url);
    expect(KNOWN_ORIGINS, `${url}: origin`).toContain(u.origin);
  }

  // Base-agnostic inclusion: in the legacy Pages build every path is prefixed
  // with /varve. Sitemap entries may or may not have trailing slashes, so
  // match on the normalized (stripped) path suffix.
  const sitemapPaths = urls.map((u) => new URL(u).pathname);
  for (const route of ROUTES) {
    const r = route.replace(/\/+$/, '') || '/';
    let found = false;
    for (const p of sitemapPaths) {
      const s = p.replace(/\/+$/, '') || '/';
      if (r === '/') {
        const segments = s.split('/').filter(Boolean);
        if (segments.length <= 1) {
          found = true;
          break;
        }
      } else if (s.indexOf(r) === s.length - r.length) {
        found = true;
        break;
      }
    }
    expect(found, `sitemap includes ${route}`).toBe(true);
  }
  for (const excluded of SITEMAP_EXCLUDED) {
    for (const path of sitemapPaths) {
      expect(path, `sitemap excludes ${excluded}`).not.toContain(excluded);
    }
  }
});

test('the 404 page is noindex and carries no canonical', async ({ page }) => {
  await page.goto('/definitely-not-a-page');
  const robots = await page.locator('meta[name="robots"]').getAttribute('content');
  expect(robots).toBe('noindex, nofollow');
  expect(await page.locator('link[rel="canonical"]').count()).toBe(0);
  await expect(page).toHaveTitle(/404|not found/i);
});
