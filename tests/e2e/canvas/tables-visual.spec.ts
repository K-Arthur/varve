/**
 * E2E: Visual verification of native responsive tables (ADR-0016).
 *
 * Tests cover:
 * - Table insertion and visual rendering
 * - Cell editing and text wrapping
 * - Column resizing and row height sync
 * - Merge/split operations
 * - Header freezing
 * - Responsive behavior
 * - Inspector controls
 * - Screenshot verification at each step
 */
import { expect, type Page, test } from '@playwright/test';
import { activateTableTool, dragOnCanvas, navigateToEditor } from '../shared';

// Preserve authored geometry while keeping the complete drawing fixture visible.
test.use({ viewport: { width: 1440, height: 1000 } });

async function insertTable(page: Page, _rows = 4, _cols = 4): Promise<void> {
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 700, 460);
}

async function enterTableEditMode(page: Page): Promise<void> {
  await page.keyboard.press('v');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.dblclick({ position: { x: 350, y: 300 } });
  await expect(page.locator('.table-edit-overlay')).toBeVisible({ timeout: 10000 });
}

/** Use rendered selection geometry so the same cell is reachable after fitting/reopening. */
async function openFirstCellText(page: Page) {
  const handle = page.locator('[aria-label="Top-left resize handle"]');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Selected table has no top-left handle');
  const x = box.x + box.width / 2 + 12;
  const y = box.y + box.height / 2 + 12;
  await page.mouse.dblclick(x, y);
  await expect(page.locator('.table-edit-overlay')).toBeVisible();
  await page.mouse.click(x, y);
  await page.keyboard.press('Enter');
  const editor = page.locator('textarea.table-cell-editor');
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('Native tables - visual verification', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('button', { name: /Customize sections/ }).click();
    await page
      .getByRole('dialog', { name: 'Customize sections' })
      .getByRole('button', { name: 'Show all sections' })
      .click();
  });

  test('1. Insert table and verify visual rendering', async ({ page }) => {
    await insertTable(page);

    // Verify table is in layers panel
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/table/i);

    // Take screenshot of inserted table
    await page.screenshot({
      path: 'test-results/tables/01-insert-table.png',
      fullPage: false,
    });

    // Verify table inspector is visible
    await expect(page.getByText('Table', { exact: true }).first()).toBeVisible();
  });

  test('2. Enter edit mode and verify cell selection', async ({ page }) => {
    await insertTable(page);
    await enterTableEditMode(page);

    // Take screenshot of edit mode
    await page.screenshot({
      path: 'test-results/tables/02-edit-mode.png',
      fullPage: false,
    });

    // Click on a cell
    await page.locator('.table-edit-overlay').click({ position: { x: 400, y: 300 } });

    // Take screenshot with cell selected
    await page.screenshot({
      path: 'test-results/tables/03-cell-selected.png',
      fullPage: false,
    });
  });

  test('3. Edit cell text and verify rendering', async ({ page }) => {
    await insertTable(page);
    await enterTableEditMode(page);

    // Select first cell and enter text
    await page.locator('.table-edit-overlay').click({ position: { x: 300, y: 280 } });
    await page.keyboard.press('Enter');

    const editor = page.locator('textarea.table-cell-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill('Hello World');
    await page.keyboard.press('Enter');

    // Take screenshot after text entry
    await page.screenshot({
      path: 'test-results/tables/04-cell-text.png',
      fullPage: false,
    });

    // Verify text is visible
    await expect(page.getByText('Hello World')).toBeVisible();
  });

  test('4. Merge cells and verify visual feedback', async ({ page }) => {
    await insertTable(page);
    await enterTableEditMode(page);

    // Enter text in first cell
    await page.locator('.table-edit-overlay').click({ position: { x: 300, y: 280 } });
    await page.keyboard.press('Enter');
    const editor = page.locator('textarea.table-cell-editor');
    await editor.fill('Merged Header');
    await page.keyboard.press('Enter');

    // Select first two cells
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowLeft');

    // Take screenshot before merge
    await page.screenshot({
      path: 'test-results/tables/05-before-merge.png',
      fullPage: false,
    });

    // Click merge button
    await page.getByRole('button', { name: 'Merge cells' }).click();

    // Take screenshot after merge
    await page.screenshot({
      path: 'test-results/tables/06-after-merge.png',
      fullPage: false,
    });
  });

  test('5. Resize column and verify layout update', async ({ page }) => {
    await insertTable(page);
    await enterTableEditMode(page);

    // Take screenshot before resize
    await page.screenshot({
      path: 'test-results/tables/07-before-resize.png',
      fullPage: false,
    });

    // Find and drag column resize handle
    // Column handles are at the top edge of the table
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (box) {
      // Drag column boundary to resize
      const handleX = box.x + 380; // Column boundary
      const handleY = box.y + 170; // Top edge

      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX + 100, handleY);
      await page.mouse.up();
    }

    // Take screenshot after resize
    await page.screenshot({
      path: 'test-results/tables/08-after-resize.png',
      fullPage: false,
    });
  });

  test('6. Add rows via inspector and verify', async ({ page }) => {
    await insertTable(page);

    // Take screenshot of initial table
    await page.screenshot({
      path: 'test-results/tables/09-initial-4x4.png',
      fullPage: false,
    });

    // Find and click the add row button
    const addRowBtn = page.getByRole('button', { name: /add row/i });
    await addRowBtn.click();
    await addRowBtn.click();
    await expect(page.getByRole('spinbutton', { name: 'Rows', exact: true })).toHaveValue('6');

    // Take screenshot after adding rows
    await page.screenshot({
      path: 'test-results/tables/10-after-add-rows.png',
      fullPage: false,
    });
  });

  test('7. Toggle zebra stripes and verify visual change', async ({ page }) => {
    await insertTable(page);

    // Take screenshot without zebra
    await page.screenshot({
      path: 'test-results/tables/11-no-zebra.png',
      fullPage: false,
    });

    // Toggle zebra stripes
    const zebraToggle = page.getByRole('switch', { name: /zebra/i });
    await zebraToggle.check();
    await expect(zebraToggle).toBeChecked();

    // Take screenshot with zebra
    await page.screenshot({
      path: 'test-results/tables/12-with-zebra.png',
      fullPage: false,
    });
  });

  test('8. Change density and verify spacing', async ({ page }) => {
    await insertTable(page);

    // Take screenshot of default density
    await page.screenshot({
      path: 'test-results/tables/13-density-comfortable.png',
      fullPage: false,
    });

    // Change to compact density
    const compact = page
      .getByRole('radiogroup', { name: 'Density', exact: true })
      .getByRole('radio', { name: 'Compact', exact: true });
    await compact.locator('xpath=ancestor::label[1]').click();
    await expect(compact).toBeChecked();

    // Take screenshot of compact density
    await page.screenshot({
      path: 'test-results/tables/14-density-compact.png',
      fullPage: false,
    });

    // Change to spacious density
    const spacious = page
      .getByRole('radiogroup', { name: 'Density', exact: true })
      .getByRole('radio', { name: 'Spacious', exact: true });
    await spacious.locator('xpath=ancestor::label[1]').click();
    await expect(spacious).toBeChecked();

    // Take screenshot of spacious density
    await page.screenshot({
      path: 'test-results/tables/15-density-spacious.png',
      fullPage: false,
    });
  });

  test('9. Freeze header row and verify visual indicator', async ({ page }) => {
    await insertTable(page);

    // Take screenshot before freezing
    await page.screenshot({
      path: 'test-results/tables/16-before-freeze.png',
      fullPage: false,
    });

    // Set frozen rows to 1
    const frozenRowsInput = page.getByRole('spinbutton', { name: /frozen rows/i });
    await frozenRowsInput.fill('1');
    await frozenRowsInput.press('Enter');
    await expect(frozenRowsInput).toHaveValue('1');

    // Take screenshot after freezing
    await page.screenshot({
      path: 'test-results/tables/17-after-freeze.png',
      fullPage: false,
    });
  });

  test('10. Enter long text and verify row height sync', async ({ page }) => {
    await insertTable(page);
    await enterTableEditMode(page);

    // Enter long text in first cell
    await page.locator('.table-edit-overlay').click({ position: { x: 300, y: 280 } });
    await page.keyboard.press('Enter');
    const editor = page.locator('textarea.table-cell-editor');
    await editor.fill(
      'This is a very long text that should wrap within the cell and increase the row height',
    );
    await page.keyboard.press('Enter');

    // Take screenshot showing text wrapping
    await page.screenshot({
      path: 'test-results/tables/18-text-wrapping.png',
      fullPage: false,
    });
  });

  test('11. Save and reload - verify persistence', async ({ page }, testInfo) => {
    await insertTable(page);

    const editor = await openFirstCellText(page);
    await expect(editor).toHaveValue('');
    await editor.fill('Persistent Text');
    await editor.press('Enter');
    await expect(editor).toHaveCount(0);
    // Read committed content through the real editor before saving; filling a
    // textarea alone does not establish that the document mutation succeeded.
    await page.keyboard.press('Enter');
    await expect(editor).toHaveValue('Persistent Text');
    await editor.press('Escape');
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('Escape');

    // Take screenshot before reload
    await page.screenshot({
      path: testInfo.outputPath('table-content-before-reload.png'),
      fullPage: false,
    });

    // Persist explicitly, then reload and reopen from Home. Browser reloads
    // intentionally return to Home rather than preserving the editor route.
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
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('Shift+2');
    const reopenedEditor = await openFirstCellText(page);
    await expect(reopenedEditor).toHaveValue('Persistent Text');
    await reopenedEditor.press('Escape');
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('Escape');

    // Take screenshot after reload
    await page.screenshot({
      path: testInfo.outputPath('table-content-after-reload.png'),
      fullPage: false,
    });
  });
});
