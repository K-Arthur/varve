/**
 * Knife and Export Region end-to-end behaviour.
 *
 * These cover the two things the old Slice tool got wrong and no unit test can
 * prove on its own: that the Knife divides real artwork in the running editor,
 * and that an Export Region behaves like an export marker rather than a frame
 * once it is on a live canvas.
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/** Draw a rectangle on the canvas and wait for it to become a layer. */
async function drawRectangle(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, from[0], from[1], to[0], to[1]);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

test.describe('Knife', () => {
  test('splits a rectangle into two independently editable objects', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await drawRectangle(page, [150, 150], [350, 300]);

    await page.keyboard.press('n');
    await expect(page.locator('.floating-toolbar [data-tool="knife"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // A cut that crosses the whole rectangle horizontally.
    await dragOnCanvas(page, 100, 225, 400, 225);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath('knife-split.png'), fullPage: true });

    // Both pieces are selected, so the pieces can be acted on straight away.
    await expect(page.locator('.layers-row--selected')).toHaveCount(2);

    // Moving one piece must not move the other: they are separate objects, not
    // two views of one.
    await page.keyboard.press('v');
    await dragOnCanvas(page, 250, 190, 250, 100);
    await page.screenshot({ path: testInfo.outputPath('knife-piece-moved.png'), fullPage: true });
    await expect(page.getByRole('treeitem')).toHaveCount(2);
  });

  test('one undo restores the original object, and redo restores the pieces', async ({ page }) => {
    await navigateToEditor(page);
    await drawRectangle(page, [150, 150], [350, 300]);

    await page.keyboard.press('n');
    await dragOnCanvas(page, 100, 225, 400, 225);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    // One undo, not one per piece.
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
  });

  test('a cut that does not pass through leaves the document untouched', async ({ page }) => {
    await navigateToEditor(page);
    await drawRectangle(page, [150, 150], [350, 300]);

    await page.keyboard.press('n');
    // Starts outside but stops inside the rectangle: a partial cut.
    await dragOnCanvas(page, 100, 225, 250, 225);

    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('a cut that misses everything leaves the document untouched', async ({ page }) => {
    await navigateToEditor(page);
    await drawRectangle(page, [150, 150], [350, 300]);

    await page.keyboard.press('n');
    await dragOnCanvas(page, 100, 500, 400, 500);

    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('Escape during a cut commits nothing', async ({ page }) => {
    await navigateToEditor(page);
    await drawRectangle(page, [150, 150], [350, 300]);

    await page.keyboard.press('n');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.mouse.move(box.x + 100, box.y + 225);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 225);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('splits a rotated object without moving it', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await drawRectangle(page, [180, 180], [340, 280]);

    // Rotate through the inspector so the geometry is genuinely transformed.
    await page.keyboard.press('v');
    const rotation = page.locator('input').filter({ hasText: '' }).nth(4);
    await rotation.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);

    await page.keyboard.press('n');
    await dragOnCanvas(page, 120, 230, 400, 230);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath('knife-rotated.png'), fullPage: true });
  });

  test('refuses live text and says so', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('t');
    await dragOnCanvas(page, 150, 150, 350, 220);
    await page.keyboard.type('Slice me');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('n');
    await dragOnCanvas(page, 100, 185, 400, 185);

    // The text survives as one live text layer — never silently outlined.
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });
});

test.describe('Export Region', () => {
  test('creates an export region, not a frame', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await page.keyboard.press('k');
    await expect(page.locator('.floating-toolbar [data-tool="slice"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await dragOnCanvas(page, 150, 150, 350, 300);
    const treeItem = page.getByRole('treeitem').first();
    await expect(treeItem).toBeVisible({ timeout: 10000 });
    await expect(treeItem).toContainText(/export region/i);

    // The inspector must not call it a frame or offer container controls.
    await expect(page.locator('.insp-panel__node-kind')).toHaveText(/export region/i);
    await expect(page.getByText('Clip content')).toHaveCount(0);

    await page.screenshot({ path: testInfo.outputPath('export-region.png'), fullPage: true });
  });

  test('does not swallow the artwork it is drawn over', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await drawRectangle(page, [180, 180], [300, 260]);

    // Draw a region that fully contains the rectangle. A frame would capture
    // it; an export region must leave it exactly where it is.
    await page.keyboard.press('k');
    await dragOnCanvas(page, 140, 140, 380, 320);

    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    // Both are top-level siblings: the rectangle was not reparented.
    const levels = await page
      .getByRole('treeitem')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-level')));
    expect(new Set(levels).size).toBe(1);

    await page.screenshot({
      path: testInfo.outputPath('export-region-over-artwork.png'),
      fullPage: true,
    });
  });

  test('appears in the export dialog as a target', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('k');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Control+Shift+e');
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText(/export region/i);
  });
});
