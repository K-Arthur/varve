import { describe, expect, it } from 'vitest';
import { canonicalUrl, ogImageUrl, siteOrigin, sitePath, siteUrl } from '../lib/siteUrl';

/**
 * The site deploys from one source in two modes (GitHub Pages /varve project
 * site, and a future custom domain at /). Every internal link, asset, canonical
 * URL, sitemap entry and robots location flows through sitePath/siteUrl — these
 * tests pin the normalization rules so a hand-written URL cannot leak back in.
 */
const BASE_VARVE = '/varve';
const BASE_ROOT = '/';
const SITE_PAGES = 'https://k-arthur.github.io';
const SITE_DOMAIN = 'https://varve.example';

describe('sitePath normalization (project-site mode, base /varve)', () => {
  it('prefixes root-relative paths with the base', () => {
    expect(sitePath('/docs', BASE_VARVE)).toBe('/varve/docs');
    expect(sitePath('/docs/tools/color', BASE_VARVE)).toBe('/varve/docs/tools/color');
    expect(sitePath('/favicon.svg', BASE_VARVE)).toBe('/varve/favicon.svg');
  });

  it('maps the root page and empty paths to the base', () => {
    expect(sitePath('/', BASE_VARVE)).toBe('/varve/');
    expect(sitePath('', BASE_VARVE)).toBe('/varve/');
  });

  it('preserves query strings and hash fragments', () => {
    expect(sitePath('/download?platform=linux', BASE_VARVE)).toBe('/varve/download?platform=linux');
    expect(sitePath('/docs#top', BASE_VARVE)).toBe('/varve/docs#top');
    expect(sitePath('#choose-platform', BASE_VARVE)).toBe('#choose-platform');
  });

  it('passes through external URLs and non-HTTP schemes untouched', () => {
    expect(sitePath('https://github.com/K-Arthur/varve', BASE_VARVE)).toBe(
      'https://github.com/K-Arthur/varve',
    );
    expect(sitePath('mailto:hello@example.com', BASE_VARVE)).toBe('mailto:hello@example.com');
    expect(sitePath('tel:+15551234567', BASE_VARVE)).toBe('tel:+15551234567');
    expect(sitePath('//cdn.example.com/app.js', BASE_VARVE)).toBe('//cdn.example.com/app.js');
  });

  it('never double-prefixes an already base-prefixed path', () => {
    expect(sitePath('/varve/docs', BASE_VARVE)).toBe('/varve/docs');
    expect(sitePath('/varve/', BASE_VARVE)).toBe('/varve/');
  });

  it('collapses duplicate slashes inside the joined path', () => {
    expect(sitePath('docs//tools', BASE_VARVE)).toBe('/varve/docs/tools');
  });
});

describe('sitePath normalization (custom-domain mode, base /)', () => {
  it('keeps root-relative paths at the root', () => {
    expect(sitePath('/docs', BASE_ROOT)).toBe('/docs');
    expect(sitePath('/favicon.svg', BASE_ROOT)).toBe('/favicon.svg');
    expect(sitePath('/', BASE_ROOT)).toBe('/');
  });
});

describe('siteUrl absolute URLs', () => {
  it('joins origin and base for absolute metadata URLs', () => {
    expect(siteUrl('/docs', BASE_VARVE, SITE_PAGES)).toBe('https://k-arthur.github.io/varve/docs');
    expect(siteUrl('/og-image.png', BASE_VARVE, SITE_PAGES)).toBe(
      'https://k-arthur.github.io/varve/og-image.png',
    );
    expect(siteUrl('', BASE_VARVE, SITE_PAGES)).toBe('https://k-arthur.github.io/varve/');
  });

  it('uses the root on a custom-domain build', () => {
    expect(siteUrl('/docs', BASE_ROOT, SITE_DOMAIN)).toBe('https://varve.example/docs');
  });

  it('returns fully-qualified URLs unchanged', () => {
    expect(siteUrl('https://example.com/x', BASE_VARVE, SITE_PAGES)).toBe('https://example.com/x');
  });
});

describe('canonicalUrl from a rendered pathname', () => {
  it('strips trailing slashes and maps the root to the base', () => {
    expect(canonicalUrl('/varve/docs/', BASE_VARVE, SITE_PAGES)).toBe(
      'https://k-arthur.github.io/varve/docs',
    );
    expect(canonicalUrl('/varve/', BASE_VARVE, SITE_PAGES)).toBe(
      'https://k-arthur.github.io/varve/',
    );
    expect(canonicalUrl('/varve/download/', BASE_VARVE, SITE_PAGES)).toBe(
      'https://k-arthur.github.io/varve/download',
    );
  });

  it('is root-relative on a custom-domain build', () => {
    expect(canonicalUrl('/docs/', BASE_ROOT, SITE_DOMAIN)).toBe('https://varve.example/docs');
    expect(canonicalUrl('/', BASE_ROOT, SITE_DOMAIN)).toBe('https://varve.example/');
  });
});

describe('siteOrigin', () => {
  it('strips a trailing slash', () => {
    expect(siteOrigin('https://varve.example/')).toBe('https://varve.example');
  });
  it('defaults to the Pages origin', () => {
    expect(siteOrigin(undefined)).toBe('https://k-arthur.github.io');
  });
});

describe('ogImageUrl', () => {
  it('builds an absolute image URL under the base', () => {
    expect(ogImageUrl('/og-image.png', BASE_VARVE, SITE_PAGES)).toBe(
      'https://k-arthur.github.io/varve/og-image.png',
    );
  });
});
