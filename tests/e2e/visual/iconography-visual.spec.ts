/**
 * Human-review screenshot matrix for the semantic icon migration.
 *
 * This deliberately uses isolated review output rather than snapshots: a
 * changed pixel is only useful after a person has judged whether the visual
 * change is intentional. Set VARVE_VISUAL_QA_DIR to retain the images in a
 * caller-owned directory; otherwise Playwright's run directory is used.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor, navigateToHome } from '../shared';

const outputDir = process.env.VARVE_VISUAL_QA_DIR ?? `test-results/visual-qa-${process.pid}`;

async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.waitForTimeout(100);
}

test.describe('Iconography visual QA', () => {
  test.describe.configure({ mode: 'serial' });

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: home default, workspace menu, tooltip, and dialog`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await navigateToHome(page);
      await setTheme(page, theme);
      const homeSurface = page.getByRole('region', { name: 'File drop zone' });
      await expect(homeSurface).toBeVisible();

      await page.screenshot({
        path: `${outputDir}/home-${theme}-default.png`,
        fullPage: false,
      });

      const workspace = page.getByRole('button', {
        name: 'Switch workspace',
        exact: true,
      });
      if (await workspace.isVisible().catch(() => false)) {
        await workspace.click();
        await expect(workspace).toHaveAttribute('aria-expanded', 'true');
        const workspaceMenu = page.locator('.workspace-switcher__dropdown');
        await expect(workspaceMenu).toBeVisible();
        await page.waitForTimeout(100);
        await workspaceMenu.screenshot({
          path: `${outputDir}/home-${theme}-workspace-menu.png`,
        });
        await page.screenshot({
          path: `${outputDir}/home-${theme}-workspace-open.png`,
          fullPage: false,
        });
        await page.keyboard.press('Escape');
      }

      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (await settings.isVisible().catch(() => false)) {
        await settings.hover();
        await page.waitForTimeout(400);
        await expect(page.getByRole('tooltip')).toBeVisible();
        await page.screenshot({
          path: `${outputDir}/home-${theme}-settings-tooltip.png`,
          fullPage: false,
        });
      }

      await page.getByRole('button', { name: /^new$/i }).click();
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.screenshot({
        path: `${outputDir}/home-${theme}-new-dialog.png`,
        fullPage: false,
      });
      await page.keyboard.press('Escape');
    });

    test(`${theme}: narrow home reflow`, async ({ page }) => {
      await page.setViewportSize({ width: 420, height: 800 });
      await navigateToHome(page);
      await setTheme(page, theme);
      await expect(page.getByRole('region', { name: 'File drop zone' })).toBeVisible();
      await page.screenshot({
        path: `${outputDir}/home-${theme}-narrow.png`,
        fullPage: false,
      });
    });

    test(`${theme}: editor toolbar`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await navigateToEditor(page);
      await setTheme(page, theme);
      await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible({
        timeout: 45000,
      });
      await expect(page.getByRole('button', { name: 'Frame', exact: true })).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `${outputDir}/editor-${theme}-toolbar.png`,
        fullPage: false,
      });
    });

    test(`${theme}: editor workspace switcher`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await navigateToEditor(page);
      await setTheme(page, theme);
      const workspace = page.getByRole('radiogroup', { name: 'Workspace' });
      await expect(workspace).toBeVisible({ timeout: 45000 });
      const workspaceIcons = workspace.locator('[data-workspace-icon]');
      await expect(workspaceIcons).toHaveCount(7);
      await workspace.screenshot({
        path: `${outputDir}/editor-${theme}-workspace-switcher.png`,
      });
    });
  }
});
