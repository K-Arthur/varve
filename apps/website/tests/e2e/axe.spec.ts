import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * axe-core scans on representative routes in both themes.
 *
 * An axe pass is not proof the visual result is correct (the computed-style
 * specs cover that), but it guards against structural a11y regressions:
 * landmarks, heading order, link names, ARIA misuse, color-only indicators
 * that axe can detect.
 */

const SCANS = [
  { route: '/', name: 'home' },
  { route: '/download', name: 'download' },
  { route: '/docs', name: 'docs' },
  { route: '/docs/workspaces', name: 'workspaces' },
  { route: '/features', name: 'features' },
  { route: '/support/faq', name: 'faq' },
  { route: '/compare', name: 'compare' },
  { route: '/learn/examples', name: 'learn-examples' },
  // Trust surfaces. These carry the contact directory and the security
  // disclosure route, so an a11y regression here blocks someone from
  // reporting a vulnerability or asking for help.
  { route: '/contact', name: 'contact' },
  { route: '/support', name: 'support' },
  { route: '/security', name: 'security' },
  { route: '/press', name: 'press' },
  { route: '/about/privacy', name: 'privacy' },
  { route: '/404', name: '404' },
];

const THEMES = [
  { name: 'light', colorScheme: 'light' as const },
  { name: 'dark', colorScheme: 'dark' as const },
];

for (const scan of SCANS) {
  for (const t of THEMES) {
    test(`${scan.name} [${t.name}] has zero axe violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await page.goto(scan.route);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const relevant = results.violations.filter(
        (v) => !['region', 'landmark-one-main'].includes(v.id),
      );
      expect(
        relevant,
        JSON.stringify(
          relevant.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
            help: v.help,
          })),
          null,
          2,
        ),
      ).toEqual([]);
    });
  }
}
