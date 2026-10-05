/**
 * E2E: native responsive tables (ADR-0016 workflow 1).
 */
import { expect, type Page, test } from '@playwright/test';
import { activateTableTool, dragOnCanvas, navigateToEditor } from '../shared';

async function insertTable(page: Page): Promise<void> {
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 700, 460);
}

async function enterTableEditMode(page: Page): Promise<void> {
  await page.keyboard.press('v');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.dblclick({ position: { x: 250, y: 220 } });
  await expect(page.locator('.table-edit-overlay')).toBeVisible({ timeout: 10000 });
}

async function tableCellCenter(page: Page, row: number, column: number) {
  // The table tool creates a 4×4 table. Read the rendered selection handles
  // instead of assuming a camera, viewport origin, or zoom.
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

test.describe('Native tables', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    // Section visibility is user-configurable and persists across browser
    // contexts. Table editing needs the optional Cells section visible.
    const manager = page.getByRole('button', { name: /Customize sections/ });
    await manager.click();
    const sectionDialog = page.getByRole('dialog', { name: 'Customize sections' });
    await sectionDialog.getByRole('button', { name: 'Show all sections' }).click();
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
    await enterTableEditMode(page);
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
    await enterTableEditMode(page);
    const firstCell = await tableCellCenter(page, 0, 0);
    const adjacentCell = await tableCellCenter(page, 0, 1);
    await page.mouse.click(firstCell.x, firstCell.y);
    // Table cell selection is a pointer interaction in the overlay; using a
    // shift-click keeps the test on that interaction path and avoids the
    // global shortcut manager stealing Shift+ArrowRight from the overlay.
    await page.keyboard.down('Shift');
    try {
      await page.mouse.click(adjacentCell.x, adjacentCell.y);
    } finally {
      await page.keyboard.up('Shift');
    }
    await expect(page.getByText('2 cells selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Merge cells' }).click();
    await page.mouse.click(firstCell.x, firstCell.y);
    await expect(page.getByRole('spinbutton', { name: /column span/i })).toHaveValue('2', {
      timeout: 5000,
    });
  });

  test('keyboard navigation moves between cells', async ({ page }) => {
    await insertTable(page);
    await enterTableEditMode(page);
    const firstCell = await tableCellCenter(page, 0, 0);
    await page.mouse.click(firstCell.x, firstCell.y);
    const activeCell = page.locator('.table-edit-overlay svg rect').last();
    const [beforeX, beforeY] = await Promise.all([
      activeCell.getAttribute('x'),
      activeCell.getAttribute('y'),
    ]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(async () => [await activeCell.getAttribute('x'), await activeCell.getAttribute('y')])
      .not.toEqual([beforeX, beforeY]);
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
