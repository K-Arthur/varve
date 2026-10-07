/**
 * Multi-window workspace visual regression specs.
 *
 * Captures screenshots of panel chrome, workspace tabs, and layout
 * across Light/Dark/HC themes for golden-baseline comparison.
 *
 * Run with:
 * npx playwright test tests/e2e/workspace/visual.spec.ts --project=chromium
 */

import { expect, test } from '@playwright/test';

const THEMES = ['light', 'dark', 'high-contrast'] as const;

async function navigateToEditor(page: import('@playwright/test').Page, theme?: string) {
  await page.goto('/', { timeout: 180_000, waitUntil: 'domcontentloaded' });
  if (theme) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
  }
  await page
    .getByRole('button', { name: /^new$/i })
    .waitFor({ state: 'visible', timeout: 180_000 });
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30_000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .waitFor({ timeout: 30_000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click({ timeout: 30_000 });
  await page.locator('.layers-panel').waitFor({ timeout: 180_000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
  // The HC Create button ends at x=970, inside the Inspector splitter's
  // eventual hit area. Capture idle chrome with the pointer clear of controls,
  // rather than preserving an incidental hover after the modal disappears.
  await page.mouse.move(0, 0);
  await expect(page.locator('.workspace-dock-splitter:hover')).toHaveCount(0);
}

for (const theme of THEMES) {
  test.describe
    .serial(`Multi-window workspace visual — ${theme}`, () => {
      test('panel headers and sidebars', async ({ page }) => {
        await navigateToEditor(page, theme);
        await expect(page.locator('.editor__layers-panel')).toHaveScreenshot(
          `panel-headers-${theme}.png`,
          { maxDiffPixels: 200 },
        );
      });

      test('inspector panel', async ({ page }) => {
        await navigateToEditor(page, theme);
        await expect(page.locator('.editor__inspector-panel')).toHaveScreenshot(
          `inspector-panel-${theme}.png`,
          {
            // The high-contrast inspector rasterises ~1535px (0.01) apart on the
            // hosted runner while light and dark stay stable — the same
            // two-state rendering variance the clip-mask thumbnail carries. The
            // bound covers the measured spread and still fails on a real change.
            maxDiffPixels: 2000,
          },
        );
      });

      test('workspace tabs', async ({ page }) => {
        await navigateToEditor(page, theme);
        const tabs = page.locator('.workspace-dock');
        if (await tabs.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(tabs).toHaveScreenshot(`workspace-tabs-${theme}.png`, {
            maxDiffPixels: 200,
          });
        }
      });

      test('full editor layout', async ({ page }) => {
        await navigateToEditor(page, theme);
        await expect(page.locator('.editor-canvas__empty-state')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Fit active canvas', exact: true }),
        ).toBeDisabled();
        await expect(page).toHaveScreenshot(`full-editor-${theme}.png`, {
          maxDiffPixels: 500,
        });
      });
    });
}
