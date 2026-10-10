/**
 * Lighthouse CI for the Varve marketing site.
 *
 * Default: audit the built `dist/` (mobile). Set `LHCI_FORM_FACTOR=desktop`
 * for the desktop pass. Set `LHCI_BASE_URL` (no trailing path) to point the
 * same assertions at a live origin such as https://varve.studio.
 *
 * Report-only: `LHCI_REPORT_ONLY=1` collects without asserting, used by the
 * post-deploy smoke follow-up.
 */
const path = require('node:path');

const PAGES = ['/', '/download/', '/features/generative-editing/', '/docs/', '/compare/'];
const formFactor = process.env.LHCI_FORM_FACTOR === 'desktop' ? 'desktop' : 'mobile';
const isDesktop = formFactor === 'desktop';
const baseUrl = (process.env.LHCI_BASE_URL || '').replace(/\/+$/, '');
const reportOnly = process.env.LHCI_REPORT_ONLY === '1';

function urls() {
  if (!baseUrl) {
    return PAGES.map((page) => `http://127.0.0.1${page}`);
  }
  return PAGES.map((page) => `${baseUrl}${page}`);
}

const collect = {
  numberOfRuns: Number(process.env.LHCI_NUMBER_OF_RUNS || 1),
  url: urls(),
  settings: {
    formFactor,
    preset: isDesktop ? 'desktop' : undefined,
    chromePath: process.env.CHROME_PATH || undefined,
    // GitHub-hosted ubuntu-latest disables unprivileged user namespaces
    // (AppArmor). Chromium then exits with "No usable sandbox" unless the
    // process sandbox is turned off. LHCI is a measurement process.
    chromeFlags: '--no-sandbox --disable-dev-shm-usage',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  },
};

if (!baseUrl) {
  collect.staticDistDir = path.join(__dirname, 'dist');
}

const assertions = {
  'categories:performance': ['error', { minScore: isDesktop ? 0.95 : 0.88 }],
  'categories:accessibility': ['error', { minScore: 0.98 }],
  'categories:best-practices': ['error', { minScore: 0.95 }],
  'categories:seo': ['error', { minScore: 0.98 }],
  'largest-contentful-paint': ['error', { maxNumericValue: isDesktop ? 900 : 3000 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
  'total-blocking-time': ['error', { maxNumericValue: isDesktop ? 50 : 150 }],
};

module.exports = {
  ci: {
    collect,
    assert: reportOnly
      ? undefined
      : {
          assertions,
          budgets: [
            {
              path: '/*',
              resourceSizes: [
                { resourceType: 'script', budget: 40 },
                { resourceType: 'font', budget: 160 },
                { resourceType: 'total', budget: 1400 },
              ],
              resourceCounts: [{ resourceType: 'third-party', budget: 0 }],
            },
          ],
        },
    upload: {
      target: 'filesystem',
      outputDir: path.join(__dirname, '../../.lighthouseci', formFactor),
    },
  },
};
