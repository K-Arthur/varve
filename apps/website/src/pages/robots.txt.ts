import type { APIRoute } from 'astro';
import { siteUrl } from '../lib/siteUrl';

/**
 * robots.txt derived from the configured site, not a static file.
 *
 * The old public/robots.txt hardcoded the Pages sitemap URL; when the site
 * moved to a custom domain the sitemap location would have gone stale in
 * exactly the file that tells crawlers where the sitemap is. Deriving it from
 * SITE_URL / SITE_BASE keeps the two in step automatically.
 */
export const GET: APIRoute = () =>
  new Response(
    [
      '# Allow all crawlers',
      'User-agent: *',
      'Allow: /',
      '',
      `# Sitemap (derived from the configured SITE_URL / SITE_BASE)`,
      `Sitemap: ${siteUrl('/sitemap.xml')}`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
