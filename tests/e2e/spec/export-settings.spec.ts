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

    await expect(page.getByRole('heading', { name: 'Export settings' })).toBeVisible();
    await expect(page.getByText(/No export settings/)).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add export setting' })).toBeVisible();
  });

  test('adds a PNG@2x export setting and previews the canonical filename', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: 'PNG', exact: true }).click();
    await page.getByRole('button', { name: '2x', exact: true }).click();
    await page.getByRole('button', { name: '+ Add export setting' }).click();

    // Canonical naming: '@2x' suffix (no '-' separator) with a .png extension.
    await expect(page.locator('.spec-export__preset-file')).toHaveText(/@2x\.png$/);
    await expect(page.locator('.spec-export__preset-summary')).toContainText('PNG');
  });

  test('toggles and removes an export setting', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: '+ Add export setting' }).click();
    const file = page.locator('.spec-export__preset-file');
    const fileName = await file.textContent();

    const checkbox = page.locator('.spec-export__preset-enabled input');
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();

    await page.getByRole('button', { name: `Remove ${fileName} export` }).click();
    await expect(page.getByText(/No export settings/)).toBeVisible();
  });

  test('opens the advanced export dialog from the inspector', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: /Open advanced export/ }).click();
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  });
});
