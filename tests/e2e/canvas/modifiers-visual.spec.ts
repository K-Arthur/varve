/**
 * E2E: current document-scoped Variables and Tokens workflow.
 * Captures the real dialog state and checks create, edit, delete, and persistence.
 */
import { expect, type Page, test } from '@playwright/test';
import {
  addColorVariable,
  closeVariablesAndTokensDialog,
  navigateToEditor,
  openVariablesAndTokensDialog,
} from '../shared';

async function createColorVariable(page: Page, name: string, hexColor: string): Promise<void> {
  await addColorVariable(page, name, hexColor);
}

test.describe('Variables and tokens dialog', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('creates a color variable and shows it in the document dialog', async ({
    page,
  }, testInfo) => {
    await createColorVariable(page, 'Primary Color', '#39d0c6');
    const dialog = await openVariablesAndTokensDialog(page);
    await expect(dialog.getByText('Primary Color', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('variables-created.png'), fullPage: false });
    await closeVariablesAndTokensDialog(dialog);
  });

  test('edits a variable value and verifies the authored value updates', async ({
    page,
  }, testInfo) => {
    await createColorVariable(page, 'Test Color', '#ff0000');
    const dialog = await openVariablesAndTokensDialog(page);
    const row = dialog.getByRole('row').filter({ hasText: 'Test Color' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '#ff0000', exact: true }).click();
    const editInput = row.getByRole('textbox', { name: 'Variable value' });
    await editInput.fill('#00ff00');
    await editInput.press('Enter');
    await expect(row.getByRole('button', { name: '#00ff00', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('variables-edited.png'), fullPage: false });
    await closeVariablesAndTokensDialog(dialog);
  });

  test('save and reload preserves the document variable', async ({ page }, testInfo) => {
    await createColorVariable(page, 'Persistence Test', '#ff0000');
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Save\s+Ctrl\+S$/i }).click();
    await expect(page.getByRole('button', { name: /^Saved\b/i })).toBeVisible({ timeout: 15000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page
      .getByRole('gridcell', { name: /^Untitled \d+,/i })
      .first()
      .dblclick();
    await page.locator('.layers-panel').waitFor({ timeout: 15000 });

    const dialog = await openVariablesAndTokensDialog(page);
    await expect(dialog.getByText('Persistence Test', { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('variables-after-reload.png'),
      fullPage: false,
    });
    await closeVariablesAndTokensDialog(dialog);
  });

  test('deletes a variable and verifies it is removed', async ({ page }) => {
    await createColorVariable(page, 'Delete Test', '#ff0000');
    const dialog = await openVariablesAndTokensDialog(page);
    const row = dialog.getByRole('row').filter({ hasText: 'Delete Test' });
    await row.getByRole('button', { name: 'Delete variable Delete Test' }).click();
    await expect(row).toHaveCount(0);
    await closeVariablesAndTokensDialog(dialog);
  });
});
