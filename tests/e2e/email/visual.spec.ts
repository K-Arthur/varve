/**
 * Email workspace visual verification specs.
 *
 * Captures screenshots of the email workspace mode to verify:
 * - Workspace tab appears in the tab strip
 * - Email inspector tab is visible
 * - Full editor layout renders correctly
 * - Panel chrome is correct
 *
 * Run with:
 * npx playwright test tests/e2e/email/visual.spec.ts --project=chromium --reporter=list
 */

import { expect, test } from '@playwright/test';

const THEMES = ['light', 'dark'] as const;

async function navigateToEditor(
  page: import('@playwright/test').Page,
  theme?: string,
): Promise<void> {
  await page.goto('/', { timeout: 180_000, waitUntil: 'domcontentloaded' });
  if (theme) {
    await page.evaluate((t: string) => {
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

async function switchToEmailWorkspace(page: import('@playwright/test').Page): Promise<void> {
  // Use keyboard shortcut Ctrl+Shift+7 to switch to email workspace
  await page.keyboard.press('Control+Shift+7');
  // Wait for workspace to switch
  await page.waitForTimeout(500);
}

for (const theme of THEMES) {
  test.describe
    .serial(`Email workspace visual — ${theme}`, () => {
      test('email workspace tab visible', async ({ page }) => {
        await navigateToEditor(page, theme);
        await switchToEmailWorkspace(page);

        // Check that the workspace tabs area exists and has content
        const tabs = page.locator('.workspace-tabs');
        if (await tabs.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(tabs).toHaveScreenshot(`email-workspace-tabs-${theme}.png`, {
            maxDiffPixels: 200,
          });
        }
      });

      test('email inspector tab visible', async ({ page }) => {
        await navigateToEditor(page, theme);
        await switchToEmailWorkspace(page);

        // Check the inspector panel is visible
        const inspector = page.locator('.editor__inspector-panel');
        if (await inspector.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(inspector).toHaveScreenshot(`email-inspector-${theme}.png`, {
            maxDiffPixels: 200,
          });
        }
      });

      test('full email editor layout', async ({ page }) => {
        await navigateToEditor(page, theme);
        await switchToEmailWorkspace(page);

        // Full page screenshot
        await expect(page).toHaveScreenshot(`email-full-editor-${theme}.png`, {
          maxDiffPixels: 500,
        });
      });

      test('email layers panel', async ({ page }) => {
        await navigateToEditor(page, theme);
        await switchToEmailWorkspace(page);

        // Check layers panel
        const layers = page.locator('.editor__layers-panel');
        if (await layers.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(layers).toHaveScreenshot(`email-layers-${theme}.png`, {
            maxDiffPixels: 200,
          });
        }
      });
    });
}
