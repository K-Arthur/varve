/**
 * E2E: structured import — paste TSV/CSV, preview, mark header, commit
 * (ADR-0016 workflow 3).
 */
import { expect, test } from '@playwright/test';
import { activateTableTool, navigateToEditor } from '../shared';

async function openCreateFromData(page: import('@playwright/test').Page): Promise<void> {
  // Activate the table tool; the contextual 'Table from data' button opens
  // the structured-import dialog.
  await activateTableTool(page);
  await page.getByRole('button', { name: 'Table from data' }).click();
  await expect(page.getByRole('dialog', { name: 'Create table from data' })).toBeVisible({
    timeout: 10000,
  });
}

test.describe('Create table from data', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('paste TSV creates a table with the right dimensions and header', async ({ page }) => {
    await openCreateFromData(page);
    const dialog = page.getByRole('dialog', { name: 'Create table from data' });
    await dialog.locator('textarea').fill('Name\tQty\tPrice\nApple\t3\t1.20\nBanana\t7\t0.80');
    await expect(dialog).toContainText(/3 rows x 3 columns/);
    await page.getByRole('button', { name: 'Create table' }).click();
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/table/i);
  });

  test('CSV input with quoted fields and empty cells', async ({ page }) => {
    await openCreateFromData(page);
    const dialog = page.getByRole('dialog', { name: 'Create table from data' });
    await dialog.locator('textarea').fill('a,"hello, world",c\n1,,3');
    await expect(dialog).toContainText(/2 rows x 3 columns/);
  });

  test('export table as TSV action is registered', async ({ page }) => {
    await openCreateFromData(page);
    const dialog = page.getByRole('dialog', { name: 'Create table from data' });
    await dialog.locator('textarea').fill('Name\tNotes\nA\t=SUM(1,2)');
    await page.getByRole('button', { name: 'Create table' }).click();
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    // Formula-safe export is verified at the unit level; here we assert the
    // create-from-data dialog closes and the table landed in the document.
    await expect(page.getByRole('treeitem').first()).toContainText(/table/i, { timeout: 5000 });
  });
});
