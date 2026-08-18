import type { APIRoute } from 'astro';
import { siteUrl } from '../lib/siteUrl';

/**
 * Generate the sitemap from the actual page files and the configured site URL.
 *
 * This replaces a hand-maintained public/sitemap.xml that listed 28 absolute
 * URLs under the Pages site for the varve repository. Every entry
 * pointed at a host that does not resolve, and nothing kept the list in step
 * with the pages that exist.
 *
 * Deriving both halves (host from `site`, paths from the filesystem) means the
 * sitemap follows a domain change and a page addition without anyone
 * remembering to edit it.
 */
const pages = import.meta.glob('./**/*.astro', { eager: true });

/** `./docs/tools/color.astro` -> `/docs/tools/color`; index files -> their directory. */
function toRoute(filePath: string): string | null {
  const relative = filePath.replace(/^\.\//, '').replace(/\.astro$/, '');

  // 404 is not a destination; dynamic routes cannot be enumerated without
  // knowing their params, and we have none today.
  if (relative === '404') return null;
  // Legacy security URL is a redirect alias for the canonical /security page.
  if (relative === 'about/security') return null;
  if (relative.includes('[')) return null;

  if (relative === 'index') return '/';
  return `/${relative.replace(/\/index$/, '')}`;
}

/**
 * Shallower pages matter more. Deriving priority from depth avoids a
 * hand-tuned table that drifts, while still telling crawlers that the home and
 * download pages outrank a nested doc page.
 */
function priority(route: string): string {
  if (route === '/') return '1.0';
  if (route === '/download') return '0.9';
  // Wedge-relevant pages get elevated priority despite their depth.
  if (route === '/features/local-first') return '0.8';
  if (route === '/features/print-production') return '0.7';
  if (route === '/compare') return '0.8';
  const depth = route.split('/').filter(Boolean).length;
  return depth <= 1 ? '0.8' : '0.6';
}

export const GET: APIRoute = ({ site }) => {
  if (!site) {
    throw new Error(
      'astro.config.mjs must define `site` for the sitemap to contain absolute URLs.',
    );
  }

  const routes = Object.keys(pages)
    .map(toRoute)
    .filter((route): route is string => route !== null)
    .sort();

  // /try is a separate Vite build output (desktop demo), not an .astro page.
  // Add it manually so crawlers and Search Console can discover it.
  if (!routes.includes('/try')) routes.push('/try');

  // `siteUrl` joins the configured site origin with the base path — the same
  // joining every link on the site uses, so a domain or base change updates
  // the sitemap without any edit here.
  const urls = routes
    .map((route) => {
      const loc = siteUrl(route === '/' ? '' : route);
      return `  <url><loc>${loc}</loc><changefreq>weekly</changefreq><priority>${priority(route)}</priority></url>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
