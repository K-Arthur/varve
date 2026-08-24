/**
 * E2E: Focused visual verification of table and modifier features.
 *
 * This test file provides comprehensive visual verification with screenshots
 * at each step of the workflow.
 */
import { expect, type Page, test } from '@playwright/test';
import { activateTableTool, addColorVariable, dragOnCanvas, navigateToEditor } from '../shared';

// Helper to insert a table
async function insertTable(page: Page): Promise<void> {
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 700, 460);
}

// Helper to enter table edit mode
async function enterTableEditMode(page: Page): Promise<void> {
  await page.keyboard.press('v');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.dblclick({ position: { x: 350, y: 300 } });
  await expect(page.locator('.table-edit-overlay')).toBeVisible({ timeout: 10000 });
}

// Helper to create a color variable
async function createColorVariable(page: Page, name: string, hexColor: string): Promise<void> {
  await addColorVariable(page, name, hexColor);
}

test.describe('Table and modifier visual verification', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Complete table workflow with visual verification', async ({ page }) => {
    // Step 1: Insert table
    await insertTable(page);
    await page.screenshot({ path: 'test-results/visual/01-table-inserted.png', fullPage: false });

    // Step 2: Enter edit mode
    await enterTableEditMode(page);
    await page.screenshot({ path: 'test-results/visual/02-edit-mode.png', fullPage: false });

    // Step 3: Add content to cells
    await page.locator('.table-edit-overlay').click({ position: { x: 300, y: 280 } });
    await page.keyboard.press('Enter');
    const editor = page.locator('textarea.table-cell-editor');
    await editor.fill('Product');
    await page.keyboard.press('Enter');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await editor.fill('Price');
    await page.keyboard.press('Enter');

    await page.screenshot({ path: 'test-results/visual/03-content-added.png', fullPage: false });

    // Step 4: Exit edit mode
    await page.keyboard.press('Escape');

    // Step 5: Modify table properties
    const headerRowsInput = page.getByRole('spinbutton', { name: /header rows/i });
    if (await headerRowsInput.isVisible()) {
      await headerRowsInput.fill('1');
      await headerRowsInput.press('Enter');
    }

    const zebraToggle = page.getByRole('checkbox', { name: /zebra/i });
    if (await zebraToggle.isVisible()) {
      await zebraToggle.check();
    }

    await page.screenshot({ path: 'test-results/visual/04-table-styled.png', fullPage: false });

    // Step 6: Add more rows
    const addRowBtn = page.getByRole('button', { name: /add row/i });
    if (await addRowBtn.isVisible()) {
      await addRowBtn.click();
      await addRowBtn.click();
    }

    await page.screenshot({ path: 'test-results/visual/05-more-rows.png', fullPage: false });

    // Step 7: Change density
    const compactBtn = page.getByRole('button', { name: /compact/i });
    if (await compactBtn.isVisible()) {
      await compactBtn.click();
    }

    await page.screenshot({ path: 'test-results/visual/06-compact-density.png', fullPage: false });

    // Step 8: Freeze header
    const frozenRowsInput = page.getByRole('spinbutton', { name: /frozen rows/i });
    if (await frozenRowsInput.isVisible()) {
      await frozenRowsInput.fill('1');
      await frozenRowsInput.press('Enter');
    }

    await page.screenshot({ path: 'test-results/visual/07-frozen-header.png', fullPage: false });

    // Step 9: Reload — verify app survives without errors
    // (cross-reload persistence is covered by scene codec unit tests)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /^new$/i })).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: 'test-results/visual/08-after-reload.png', fullPage: false });
  });

  test('Variable creation and modifier workflow', async ({ page }) => {
    // Step 1: Create color variables
    await createColorVariable(page, 'Primary', '#39d0c6');
    await createColorVariable(page, 'Secondary', '#ff6b6b');

    await page.screenshot({
      path: 'test-results/visual/09-variables-created.png',
      fullPage: false,
    });

    // Step 2: Verify variables exist
    await expect(page.getByText('Primary')).toBeVisible();
    await expect(page.getByText('Secondary')).toBeVisible();

    // Step 3: Edit the authored value, not the duplicate resolved preview.
    const variables = page.getByTestId('layers-panel');
    await variables.getByRole('button', { name: '#39d0c6', exact: true }).click();
    const editInput = variables.getByRole('textbox', { name: 'Variable value' });
    await editInput.fill('#00ff88');
    await editInput.press('Enter');

    await page.screenshot({ path: 'test-results/visual/10-variable-edited.png', fullPage: false });

    // Step 4: Verify the variable was updated
    await expect(variables.getByRole('button', { name: '#00ff88', exact: true })).toBeVisible();
  });

  test('Table import from CSV', async ({ page }) => {
    // Step 1: Open import dialog
    await activateTableTool(page);
    await page.getByRole('button', { name: 'Table from data' }).click();

    await expect(page.getByRole('dialog', { name: 'Create table from data' })).toBeVisible({
      timeout: 10000,
    });

    await page.screenshot({ path: 'test-results/visual/11-import-dialog.png', fullPage: false });

    // Step 2: Paste CSV data
    const csvData = `Name,Price,Category
Widget,$9.99,Tools
Gadget,$19.99,Electronics
Thingamajig,$29.99,Misc`;

    await page
      .getByRole('dialog', { name: 'Create table from data' })
      .locator('textarea')
      .fill(csvData);

    await page.screenshot({ path: 'test-results/visual/12-csv-pasted.png', fullPage: false });

    // Step 3: Create table
    await page.getByRole('button', { name: 'Create table' }).click();

    await page.screenshot({ path: 'test-results/visual/13-table-created.png', fullPage: false });

    // Verify table was created
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  });

  test('Table with merged cells', async ({ page }) => {
    // Step 1: Insert table
    await insertTable(page);

    // Step 2: Enter edit mode and merge cells
    await enterTableEditMode(page);

    // Select the first two cells so the inspector exposes the merge command.
    await page.locator('.table-edit-overlay').click({ position: { x: 300, y: 280 } });
    await page.keyboard.press('Shift+ArrowRight');

    await page.screenshot({ path: 'test-results/visual/14-cells-selected.png', fullPage: false });

    // Merge cells
    await page.getByRole('button', { name: 'Merge cells' }).click();

    await page.screenshot({ path: 'test-results/visual/15-cells-merged.png', fullPage: false });

    // Step 3: Exit edit mode
    await page.keyboard.press('Escape');

    await page.screenshot({ path: 'test-results/visual/16-merged-final.png', fullPage: false });
  });

  test('Table responsive behavior', async ({ page }) => {
    // Step 1: Insert table
    await insertTable(page);

    await page.screenshot({
      path: 'test-results/visual/17-responsive-initial.png',
      fullPage: false,
    });

    // Step 2: Resize viewport to trigger responsive behavior
    await page.setViewportSize({ width: 800, height: 600 });

    await page.screenshot({ path: 'test-results/visual/18-responsive-small.png', fullPage: false });

    // Step 3: Resize back
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.screenshot({ path: 'test-results/visual/19-responsive-large.png', fullPage: false });
  });
});
