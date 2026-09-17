import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Inspector export settings — per-node export configurations.
 *
 * Covers the canonical capability-driven inspector surface: empty state,
 * adding a configuration (with canonical filename preview), toggling and
 * removing a configuration, and handing off to the advanced batch dialog.
 */
test.describe('Inspector export settings — per-node configurations', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function selectExportTab(page: import('@playwright/test').Page) {
    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    // Narrow layouts (and contextual frame selections) can move Export behind
    // the inspector's More menu; the overflow policy is shared workspace
    // configuration (see the 2026-09-17 review's D3), so follow the menu here
    // exactly as a user would.
    if ((await exportTab.count()) === 0 || !(await exportTab.isVisible().catch(() => false))) {
      const moreBtn = page.getByRole('button', { name: /More inspector tabs/i });
      if (await moreBtn.isVisible().catch(() => false)) {
        await moreBtn.click();
        await page.getByRole('menuitem', { name: /^Export$/i }).click();
        return;
      }
    }
    await exportTab.waitFor({ state: 'visible', timeout: 5000 });
    await exportTab.click();
  }

  async function createExportableFrame(page: import('@playwright/test').Page) {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  }

  test('shows the per-node export settings section with an empty state', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await expect(page.getByRole('heading', { name: 'Quick export' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export configurations' })).toBeVisible();
    await expect(page.getByText(/No saved configurations yet/)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Add configuration' })).toBeVisible();
    await expect(page.getByText('Preset library', { exact: true })).toBeVisible();
    await expect(page.getByText('Custom format', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add configuration' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open export workspace/ })).toBeVisible();
    await expect(page.getByText(/\\u2026/)).toHaveCount(0);

    const inspectorFits = await page.locator('#insp-tabpanel-export').evaluate((element) => {
      return element.scrollWidth <= element.clientWidth + 1;
    });
    expect(inspectorFits).toBe(true);
  });

  test('adds a PNG@2x export setting and previews the canonical filename', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('radio', { name: 'PNG', exact: true }).click();
    await page.getByRole('radio', { name: '2x', exact: true }).click();
    await page.getByRole('button', { name: 'Add configuration' }).click();

    // Canonical naming: '@2x' suffix (no '-' separator) with a .png extension.
    await expect(page.locator('.spec-export__preset-file')).toHaveText(/@2x\.png$/);
    // The badge carries the format; the summary carries scale and suffix.
    await expect(page.locator('.spec-export__preset-row .format-badge')).toHaveText('PNG');
    await expect(page.locator('.spec-export__preset-summary')).toContainText('2x');
  });

  test('toggles and removes an export setting', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: 'Add configuration' }).click();
    const file = page.locator('.spec-export__preset-file');
    const fileName = await file.textContent();

    const checkbox = page.locator('.spec-export__preset-enabled input');
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();

    await page.getByRole('button', { name: `Remove ${fileName} export` }).click();
    await expect(page.getByText(/No saved configurations yet/)).toBeVisible();
  });

  test('opens the advanced export dialog from the inspector', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: /Open export workspace/ }).click();
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  });
});
