/**
 * Metadata for the staged public browser demo.
 *
 * The desktop/Tauri app uses the same index.html, but only the VITE_DEMO=1
 * build is a public search destination. Keep this transform here so the
 * normal desktop shell does not claim a web canonical URL.
 */
export const DEMO_CANONICAL_URL = 'https://varve.studio/try/';
export const DEMO_SOCIAL_IMAGE_URL = 'https://varve.studio/og-image.png';
export const DEMO_TITLE = 'Try Varve in your browser — Varve design suite';
export const DEMO_DESCRIPTION =
  'Try Varve, a local-first design suite for vector, layout, typography, and prototyping, directly in your browser. No account or download required.';

const DEMO_SEO_MARKER = '<meta name="varve-demo-seo" content="v1" />';

/** Add crawler and link-preview metadata to the public demo build only. */
export function injectDemoSeo(html: string): string {
  if (html.includes(DEMO_SEO_MARKER)) return html;

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${DEMO_CANONICAL_URL}#webpage`,
    url: DEMO_CANONICAL_URL,
    name: DEMO_TITLE,
    description: DEMO_DESCRIPTION,
    inLanguage: 'en',
    about: {
      '@type': 'SoftwareApplication',
      name: 'Varve',
      applicationCategory: 'DesignApplication',
      operatingSystem: 'Linux, macOS, Windows',
      url: 'https://varve.studio/',
      isAccessibleForFree: true,
    },
  });

  const metadata = [
    DEMO_SEO_MARKER,
    `<meta name="description" content="${DEMO_DESCRIPTION}" />`,
    '<meta name="robots" content="index, follow" />',
    `<link rel="canonical" href="${DEMO_CANONICAL_URL}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Varve" />',
    `<meta property="og:url" content="${DEMO_CANONICAL_URL}" />`,
    `<meta property="og:title" content="${DEMO_TITLE}" />`,
    `<meta property="og:description" content="${DEMO_DESCRIPTION}" />`,
    `<meta property="og:image" content="${DEMO_SOCIAL_IMAGE_URL}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Varve — local-first design suite for vector, layout, typography, motion, prototyping, and print" />',
    '<meta property="og:locale" content="en_US" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${DEMO_TITLE}" />`,
    `<meta name="twitter:description" content="${DEMO_DESCRIPTION}" />`,
    `<meta name="twitter:image" content="${DEMO_SOCIAL_IMAGE_URL}" />`,
    '<meta name="twitter:image:alt" content="Varve — local-first design suite for vector, layout, typography, motion, prototyping, and print" />',
    `<script type="application/ld+json">${structuredData}</script>`,
  ].join('\n    ');

  return html.replace('<title>Varve</title>', `<title>${DEMO_TITLE}</title>\n    ${metadata}`);
}
