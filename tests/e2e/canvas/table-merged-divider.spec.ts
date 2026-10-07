/**
 * E2E: merged table cells — structural verification + review screenshots.
 *
 * The deterministic divider-suppression proof lives in the engine replay
 * unit test (tablePrimitive.test.ts); merge/split/undo round trips are
 * covered by scene tableOps unit tests. This spec drives the real UI merge
 * flow, asserts the merge committed structurally (span shown in the Cells
 * inspector), and captures before/after screenshots for manual review.
 */
import { expect, type Page, test } from '@playwright/test';
import { activateTableTool, dragOnCanvas, navigateToEditor } from '../shared';

// Preserve authored geometry while keeping the complete drawing fixture visible.
test.use({ viewport: { width: 1440, height: 1000 } });

async function tableCellCenter(page: Page, row: number, column: number) {
  const handleCenter = async (label: string) => {
    const box = await page.locator(`[aria-label="${label}"]`).boundingBox();
    if (!box) throw new Error(`Table selection handle is missing: ${label}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const [topLeft, topRight, bottomLeft] = await Promise.all([
    handleCenter('Top-left resize handle'),
    handleCenter('Top-right resize handle'),
    handleCenter('Bottom-left resize handle'),
  ]);
  const u = (column + 0.5) / 4;
  const v = (row + 0.5) / 4;
  return {
    x: topLeft.x + (topRight.x - topLeft.x) * u + (bottomLeft.x - topLeft.x) * v,
    y: topLeft.y + (topRight.y - topLeft.y) * u + (bottomLeft.y - topLeft.y) * v,
  };
}

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
  const firstCell = await tableCellCenter(page, 0, 0);
  await page.mouse.click(firstCell.x, firstCell.y);
  await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Merge cells' }).click();

  // The merge button should be gone (selection is now a single spanned cell).
  await expect(page.getByRole('button', { name: 'Merge cells' })).toHaveCount(0, {
    timeout: 5000,
  });

  // Click the merged cell to select it and show its span in the inspector.
  await page.mouse.click(firstCell.x, firstCell.y);
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
