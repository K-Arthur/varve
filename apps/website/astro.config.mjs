import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';

/**
 * Site URL and base path are environment-driven.
 *
 * The production defaults target the purchased custom domain
 * (`https://varve.studio`, root base) — this is what the deploy workflow
 * builds with no extra environment. The legacy GitHub Pages project-site
 * mode (`https://k-arthur.github.io` with base `/varve`) is still supported
 * via SITE_URL/SITE_BASE for the CI dual-mode suite (`build:website:pages`)
 * and for rollback.
 *
 * This previously hardcoded `site: 'https://strata.design'` with `base: '/'`.
 * That domain was not owned, and GitHub Pages served a project repository
 * from `https://<user>.github.io/<repo>/` — so absolute asset paths 404'd,
 * and every canonical URL, sitemap entry and og:url pointed at a host that
 * did not resolve.
 */
const SITE_URL = process.env.SITE_URL ?? 'https://varve.studio';
const SITE_BASE = process.env.SITE_BASE ?? '/';

export default defineConfig({
  integrations: [tailwind()],
  site: SITE_URL,
  base: SITE_BASE,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
