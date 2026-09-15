/**
 * E2E: merged table cells — structural verification + review screenshots.
 *
 * The deterministic divider-suppression proof lives in the engine replay
 * unit test (tablePrimitive.test.ts); merge/split/undo round trips are
 * covered by scene tableOps unit tests. This spec drives the real UI merge
 * flow, asserts the merge committed structurally (span shown in the Cells
 * inspector), and captures before/after screenshots for manual review.
 */
import { expect, test } from '@playwright/test';
import { activateTableTool, dragOnCanvas, navigateToEditor } from '../shared';

test('merged header cell: structural span + review screenshots', async ({ page }) => {
  await navigateToEditor(page);

  // Insert 4x4 table
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 700, 460);

  // Screenshot: fresh table (no merge)
  await page.screenshot({
    path: 'test-results/visual/review-01-fresh-table.png',
    fullPage: false,
  });

  // Enter table edit mode
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.dblclick({ position: { x: 350, y: 300 } });
  await expect(page.locator('.table-edit-overlay')).toBeVisible({ timeout: 10000 });

  // Select the first two cells of the first row and merge them.
  await page.locator('.table-edit-overlay').click({ position: { x: 300, y: 280 } });
  await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Merge cells' }).click();

  // The merge button should be gone (selection is now a single spanned cell).
  await expect(page.getByRole('button', { name: 'Merge cells' })).toHaveCount(0, {
    timeout: 5000,
  });

  // Click the merged cell to select it and show its span in the inspector.
  await page.locator('.table-edit-overlay').click({ position: { x: 400, y: 280 } });
  await expect(page.getByRole('spinbutton', { name: /column span/i })).toBeVisible({
    timeout: 5000,
  });

  // The Cells inspector should report a 2-column span on the merged cell.
  const colSpanInput = page.getByRole('spinbutton', { name: /column span/i });
  await expect(colSpanInput).toHaveValue('2', { timeout: 5000 });

  // Screenshot: merged cell with selection overlay visible.
  await page.screenshot({
    path: 'test-results/visual/review-02-merged-selected.png',
    fullPage: false,
  });

  // Exit edit mode and capture the final rendered table.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.screenshot({
    path: 'test-results/visual/review-03-merged-final.png',
    fullPage: false,
  });
});
