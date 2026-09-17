/**
 * Variables and tokens dialog — reachability and structure.
 *
 * The dialog is hosted by the Inspector (PropertiesPanel) but is
 * document-scoped. It was historically unreachable: the `openVariablesPanel`
 * action existed in the registry with a handler, yet no menu item, shortcut,
 * or button invoked it (its own comment claimed a "command palette" that the
 * editor does not have). These specs pin the real entry point
 * (View → Panels → Variables and Tokens…), the heading hierarchy inside the
 * dialog, and the zero-variables empty state.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function openVariablesDialog(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const viewMenu = page.getByRole('menu', { name: 'View' });
  await expect(viewMenu).toBeVisible();
  await viewMenu.getByRole('menuitem', { name: 'Panels', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Variables and Tokens…' }).click();
  await expect(page.getByRole('dialog', { name: 'Variables and tokens' })).toBeVisible();
}

test.describe('Variables and tokens dialog', () => {
  test('opens from View → Panels and closes on Escape', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('hosts the two panels with a correct heading hierarchy', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
    // The dialog title is an h2; both hosted panels must be h3 under it —
    // not a second h2 (Token Sync's old heading) and not a bare span
    // (Variables' old title).
    await expect(dialog.getByRole('heading', { name: 'Variables', exact: true })).toHaveCount(1);
    await expect(dialog.getByRole('heading', { name: 'Token Sync', exact: true })).toHaveCount(1);
    for (const name of ['Variables', 'Token Sync']) {
      const level = await dialog
        .getByRole('heading', { name, exact: true })
        .evaluate((el) => Number(el.tagName.substring(1)));
      expect(level).toBe(3);
    }
  });

  test('shows an empty state instead of a bare table when no variables exist', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
    await expect(dialog.getByText(/No variables yet\./)).toBeVisible();
    // The add affordance stays reachable from the empty state.
    await expect(dialog.getByRole('button', { name: '+ Add' })).toBeVisible();
  });
});
