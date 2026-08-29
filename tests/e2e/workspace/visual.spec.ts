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
          { maxDiffPixels: 200 },
        );
      });

      test('workspace tabs', async ({ page }) => {
        await navigateToEditor(page, theme);
        const tabs = page.locator('.workspace-tabs');
        if (await tabs.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(tabs).toHaveScreenshot(`workspace-tabs-${theme}.png`, {
            maxDiffPixels: 200,
          });
        }
      });

      test('full editor layout', async ({ page }) => {
        await navigateToEditor(page, theme);
        await expect(page.locator('.editor-canvas__empty-state')).toBeVisible();
        await expect(page).toHaveScreenshot(`full-editor-${theme}.png`, {
          maxDiffPixels: 500,
        });
      });
    });
}
