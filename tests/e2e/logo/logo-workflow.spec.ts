import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Logo workflow smoke tests — workspace switch, logo project creation,
 * geometry commands, small-size preview, and package export entry.
 */
test.describe('Logo workflow', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('switches to the Logo workspace via shortcut', async ({ page }) => {
    await page.keyboard.press('Control+Shift+6');
    await expect(page.getByRole('radio', { name: 'Logo workspace', exact: true })).toBeChecked();
  });

  test('New Logo Project creates an artboard + concept and selects it', async ({ page }) => {
    await page.keyboard.press('Control+Alt+n');
    // The new logo artboard frame appears in the layers tree.
    await expect(page.getByRole('treeitem').first()).toContainText(/Concept 1/i, {
      timeout: 15000,
    });
    // A frame node was created on the canvas.
    await expect(page.getByRole('treeitem').filter({ hasText: /Concept 1/i })).toBeVisible();
  });

  test('geometry menu exposes logo path operations', async ({ page }) => {
    await page.getByRole('menuitem', { name: /^Object/i }).click();
    const pathItem = page.getByRole('menuitem', { name: /^Path/ });
    // Object is taller than the viewport at this size; bring the submenu
    // trigger into the scrollable menubar surface before opening it.
    await pathItem.scrollIntoViewIfNeeded();
    await pathItem.hover();
    const pathMenu = page.locator('[role="menu"][aria-label="Path"]');
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
