/**
 * One canonical URL system for the whole site.
 *
 * The site deploys in two modes from the same source:
 *
 *   - production custom domain:    origin https://varve.studio, base /
 *   - legacy GitHub Pages project site: origin https://k-arthur.github.io,
 *     base /varve (CI dual-mode suite and rollback only)
 *
 * `SITE_URL` / `SITE_BASE` in astro.config.mjs drive both modes; every link,
 * asset, canonical URL, OG image, sitemap entry and robots location must be
 * derived from them rather than hand-written. A root-relative `href="/docs"`
 * escapes the /varve project path on Pages and 404s; a hand-written
 * `https://k-arthur.github.io/varve/...` breaks the moment the custom domain
 * is the origin. Both classes of bug are what this module exists to make
 * impossible.
 *
 * `sitePath` produces a base-prefixed relative URL for internal links and
 * assets. `siteOrigin` produces absolute URLs for metadata that must be
 * absolute (canonical, OG, sitemap, JSON-LD).
 *
 * Every function accepts its inputs for testability; in the app the defaults
 * read `import.meta.env` (BASE_URL from the Astro base, SITE from the site).
 */

const DEFAULT_SITE = 'https://varve.studio';

function baseOf(base: string | undefined): string {
  const value = base || '/';
  return value.endsWith('/') ? value : `${value}/`;
}

/** The configured base path, always with a trailing slash. */
export function basePath(base?: string): string {
  return baseOf(base ?? import.meta.env.BASE_URL);
}

/** The configured site origin, without a trailing slash (e.g. https://varve.studio). */
export function siteOrigin(site?: string): string {
  return (site ?? import.meta.env.SITE ?? DEFAULT_SITE).replace(/\/+$/, '');
}

/** Scheme (mailto:, tel:, https:, ...) or protocol-relative (//) or fragment (#). */
const NON_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** True when a path is already prefixed with the configured base. */
function isBasePrefixed(path: string, base: string): boolean {
  if (base === '/') return true;
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  return path === base || path.startsWith(withSlash);
}

/**
 * Base-prefixed relative URL for an internal page or asset.
 *
 * `sitePath('/docs')` -> `/docs` on the production build, `/varve/docs` on
 * the legacy Pages build. External URLs, mailto:/tel:/other schemes,
 * fragments, protocol-relative URLs and already-prefixed paths pass through
 * unchanged.
 *
 * An empty path or the root page maps to the base itself.
 */
export function sitePath(path: string, base?: string): string {
  if (!path) return baseOf(base ?? import.meta.env.BASE_URL);
  if (NON_LOCAL.test(path)) return path;
  const prefix = baseOf(base ?? import.meta.env.BASE_URL);
  if (isBasePrefixed(path, prefix)) return path;

  const clean = path.replace(/^\/+/, '');
  // Join and collapse runs of slashes without touching `//` inside a scheme.
  return (prefix + clean).replace(/([^:])\/+/g, '$1/');
}

/**
 * Absolute URL for canonical/OG/sitemap-style metadata.
 *
 * `siteUrl('/docs')` -> `https://varve.studio/docs` on production,
 * `https://k-arthur.github.io/varve/docs` on the legacy Pages build. Also
 * accepts a full URL, which is returned unchanged.
 */
export function siteUrl(path: string, base?: string, site?: string): string {
  const full = /^[a-z][a-z0-9+.-]*:/i.test(path);
  if (full) return path;
  const origin = siteOrigin(site);
  const joined = `${origin}${sitePath(path, base)}`;
  return joined.replace(/([^:])\/+/g, '$1/');
}

/**
 * Resolve the page's own canonical URL from its rendered URL.
 *
 * `Astro.url.pathname` already carries the base path in a base-aware build
 * (`/varve/docs/`), so the canonical is origin + pathname, with the trailing
 * slash removed and the root mapped to the bare base.
 */
export function canonicalUrl(pathname: string, base?: string, site?: string): string {
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  const origin = siteOrigin(site);
  const prefix = baseOf(base ?? import.meta.env.BASE_URL);
  const bareBase = prefix === '/' ? '/' : prefix.replace(/\/+$/, '');
  // The root page renders as the base itself (e.g. /varve/) — keep its slash.
  if (trimmed === bareBase) return `${origin}${prefix}`;
  return `${origin}${trimmed}`;
}

/** Absolute URL for the Open Graph / social image. */
export function ogImageUrl(imagePath: string, base?: string, site?: string): string {
  return siteUrl(imagePath, base, site);
}
