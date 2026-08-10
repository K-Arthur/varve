import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';

/**
 * Site URL and base path are environment-driven.
 *
 * This previously hardcoded `site: 'https://strata.design'` with `base: '/'`.
 * That domain is not owned, and GitHub Pages serves a project repository from
 * `https://<user>.github.io/<repo>/` — so absolute asset paths 404'd, and every
 * canonical URL, sitemap entry and og:url pointed at a host that does not
 * resolve.
 *
 * The defaults now target the free deployment that actually exists. When a
 * domain is bought, set SITE_URL and SITE_BASE in the deploy workflow; no
 * source change is needed.
 */
const SITE_URL = process.env.SITE_URL ?? 'https://k-arthur.github.io';
const SITE_BASE = process.env.SITE_BASE ?? '/varve';

export default defineConfig({
  integrations: [tailwind()],
  site: SITE_URL,
  base: SITE_BASE,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
