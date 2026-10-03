import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

/**
 * Logo workflow smoke tests — Logo Tools action, project creation,
 * geometry commands, small-size preview, and package export entry.
 */
test.describe('Logo workflow', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('opens Logo Tools in Design via shortcut', async ({ page }) => {
    await page.keyboard.press('Control+Shift+7');
    await expect(page.getByRole('radio', { name: 'Design workspace', exact: true })).toBeChecked();
    await expect(page.getByTestId('logo-panel')).toBeVisible();
  });

  test('New Logo Project creates an artboard + concept and selects it', async ({ page }) => {
    await page.keyboard.press('Control+Alt+n');
    // The new logo artboard frame appears in the layers tree.
    const concept = page.getByRole('treeitem').filter({ hasText: /Concept 1/i });
    await expect(concept).toHaveCount(1, {
      timeout: 15000,
    });
    await expect(concept).toBeVisible();
  });

  test('geometry menu exposes logo path operations', async ({ page }) => {
    await openMenu(page, 'Object');
    // The editor menubar supports keyboard type-ahead and ArrowRight for
    // submenu navigation. Keep this workflow test independent of hover timing
    // at the bottom edge of the tall Object menu.
    const pathItem = page.getByRole('menuitem', { name: 'Path', exact: true });
    await page.keyboard.type('Path');
    await page.keyboard.press('ArrowRight');
    const pathMenu = page.locator('[role="menu"][aria-label="Path"]');
    await expect(pathItem).toHaveAttribute('aria-expanded', 'true');
    await expect(
      pathMenu.getByRole('menuitem', { name: /Expand Stroke to Outline/i }),
    ).toBeVisible();
    await expect(
      pathMenu.getByRole('menuitem', { name: /Mirror Duplicate/i }).first(),
    ).toBeVisible();
    await expect(pathMenu.getByRole('menuitem', { name: /Radial Duplicate/i })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('small-size preview dialog opens with the size ladder', async ({ page }) => {
    await page.keyboard.press('Control+Alt+n');
    await page
      .locator('.layers-panel')
      .getByText(/Concept 1/i)
      .first()
      .waitFor({ timeout: 15000 });
    await page.keyboard.press('Control+Alt+Shift+p');
    const dialog = page.getByRole('dialog', { name: /Test Logo at Small Sizes/i });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await expect(dialog.getByText('16px')).toBeVisible();
    await expect(dialog.getByText('128px')).toBeVisible();
    await dialog.getByRole('button', { name: /Close dialog/i }).click();
  });

  test('Export Logo Package is disabled without a logo project', async ({ page }) => {
    await page.getByRole('menuitem', { name: /^File/i }).click();
    const item = page.getByRole('menuitem', { name: /Export Logo Package/i });
    await expect(item).toBeDisabled();
  });
});
