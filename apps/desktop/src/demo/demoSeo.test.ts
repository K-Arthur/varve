import { describe, expect, it } from 'vitest';
import {
  DEMO_CANONICAL_URL,
  DEMO_DESCRIPTION,
  DEMO_SOCIAL_IMAGE_URL,
  DEMO_TITLE,
  injectDemoSeo,
} from './demoSeo';

const SHELL = '<!doctype html><html><head><title>Varve</title></head><body></body></html>';

describe('public browser demo metadata', () => {
  it('adds canonical, description, social cards, and WebPage data', () => {
    const html = injectDemoSeo(SHELL);

    expect(html).toContain(`<title>${DEMO_TITLE}</title>`);
    expect(html).toContain(`<meta name="description" content="${DEMO_DESCRIPTION}" />`);
    expect(html).toContain(`<link rel="canonical" href="${DEMO_CANONICAL_URL}" />`);
    expect(html).toContain(`<meta property="og:image" content="${DEMO_SOCIAL_IMAGE_URL}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"WebPage"');
  });

  it('is idempotent when the HTML transform is called twice', () => {
    const once = injectDemoSeo(SHELL);
    expect(injectDemoSeo(once)).toBe(once);
  });
});
