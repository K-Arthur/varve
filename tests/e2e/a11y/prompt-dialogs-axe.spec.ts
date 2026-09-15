import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// Scoped scans for the dialog family touched by the PromptDialog/ConfirmDialog
// migration onto @varve/ui's shared Dialog/AlertDialog (see git history for
// packages/editor/src/components/PromptDialog.tsx) and the PageNav context
// menu's new "Move page left/right" commands.

test.describe('Page context menu - axe-core scan', () => {
  test('page tab context menu has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('radio', { name: 'Print workspace' }).click();

    await page.getByRole('button', { name: 'Add publishing page' }).click();
    const pageTab = page.getByRole('tab', { name: /^Publishing page:/i }).first();
    await pageTab.waitFor({ state: 'visible' });
    await pageTab.click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Move page left' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[role="menu"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('PromptDialog - axe-core scan', () => {
  test('rename-page prompt has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('radio', { name: 'Print workspace' }).click();

    await page.getByRole('button', { name: 'Add publishing page' }).click();
    const pageTab = page.getByRole('tab', { name: /^Publishing page:/i }).first();
    await pageTab.waitFor({ state: 'visible' });
    await pageTab.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename page' }).click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    // Regression guard for the Enter-key/label fixes: the input must have an
    // accessible name and must not be role-less.
    await expect(dialog.getByRole('textbox')).toHaveAccessibleName(/./);

    const results = await new AxeBuilder({ page })
      .include('dialog[open]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
