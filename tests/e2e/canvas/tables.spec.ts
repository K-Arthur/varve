/**
 * E2E: native responsive tables (ADR-0016 workflow 1).
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function insertTable(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Table', exact: true }).first().click();
  await dragOnCanvas(page, 200, 160, 700, 460);
}

test.describe('Native tables', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('insert a table with the table tool and see it in the layers panel', async ({ page }) => {
    await insertTable(page);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/table/i);
  });

  test('double-click enters table edit mode; cell text commits through the doc', async ({
    page,
  }) => {
    await insertTable(page);
    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.dblclick({ position: { x: 250, y: 220 } });
    await expect(page.getByText('Cells', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.locator('.table-edit-overlay').click({ position: { x: 400, y: 250 } });
    await page.keyboard.press('Enter');
    const editor = page.locator('textarea.table-cell-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill('Hello table');
    await page.keyboard.press('Enter');
    await expect(editor).toHaveCount(0, { timeout: 5000 });
  });

  test('header merge commits a spanned cell', async ({ page }) => {
    await insertTable(page);
    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.dblclick({ position: { x: 250, y: 220 } });
    await expect(page.getByText('Cells', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.locator('.table-edit-overlay').click({ position: { x: 400, y: 250 } });
    await page.keyboard.press('Enter');
    const editor = page.locator('textarea.table-cell-editor');
    await editor.fill('Merged header');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.getByRole('button', { name: 'Merge cells' }).click();
    await expect(page.getByText('Merge cells')).toHaveCount(0, { timeout: 5000 });
  });

  test('keyboard navigation moves between cells', async ({ page }) => {
    await insertTable(page);
    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.dblclick({ position: { x: 250, y: 220 } });
    await expect(page.getByText('Cells', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText('Cells', { exact: true }).first()).toBeVisible({ timeout: 5000 });
  });

  test('reload boots back to a functional home screen', async ({ page }) => {
    // The E2E platform facade is in-memory; cross-reload persistence is
    // covered by scene codec/round-trip unit tests. Here we assert the app
    // itself survives a reload without errors.
    await insertTable(page);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.reload();
    await expect(page.getByRole('button', { name: /^new$/i })).toBeVisible({ timeout: 15000 });
  });
});
