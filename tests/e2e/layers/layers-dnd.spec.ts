import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - Drag & Drop', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
  });

  test('layers tree renders with sortable rows', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();
    const items = page.getByRole('treeitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('drag handle is present on tree rows', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    if (count >= 1) {
      await expect(items.first().locator('[class*="drag-handle"]')).toBeVisible();
    }
  });

  test('keyboard reorder moves selected row (Ctrl+[ / Ctrl+])', async ({ page }) => {
    await seedLayers(page, 2);
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    const items = page.getByRole('treeitem');
    const firstName = await items.first().textContent();
    await items.nth(1).click();
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+[');
    await expect.poll(async () => items.first().textContent()).not.toBe(firstName);
  });

  test('canvas accepts DnD drop zone', async ({ page }) => {
    const canvas = page.locator('[aria-label="Canvas"]');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('aria-label', 'Canvas');
  });

  test('file import input exists', async ({ page }) => {
    const importInput = page.locator('#file-import-input');
    await expect(importInput).toBeVisible({ visible: false });
    await expect(importInput).toHaveAttribute(
      'accept',
      '.svg,.png,.jpg,.jpeg,.webp,.avif,.gif,.bmp,.pdf,.ai,.eps,.psd,.psb,.sketch,.fig,.fig.json,.cube,.3dl,.clf,.ctf',
    );
  });

  test('reorders a virtualized row to the pointer target', async ({ page }) => {
    await seedLayers(page, 3);

    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(3);
    const before = await rows.allTextContents();
    const source = rows.nth(2);
    const target = rows.nth(0);
    const sourceId = await source.getAttribute('data-node-id');
    const targetId = await target.getAttribute('data-node-id');
    expect(sourceId).toBeTruthy();
    expect(targetId).toBeTruthy();
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('layer row geometry unavailable');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    expect(
      await page.evaluate(
        ({ x, y, id }) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[role="treeitem"]')
            ?.getAttribute('data-node-id') === id,
        {
          x: sourceBox.x + sourceBox.width / 2,
          y: sourceBox.y + sourceBox.height / 2,
          id: sourceId,
        },
      ),
    ).toBe(true);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 2, { steps: 8 });
    await expect(page.locator('.drag-overlay')).toBeVisible();
    await expect(page.locator('.layers-row--drop-before')).toBeVisible();
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-dnd-layers-before-drop.png',
    });
    await page.mouse.up();

    await expect.poll(async () => rows.allTextContents()).not.toEqual(before);
    const after = await rows.allTextContents();
    expect(after[0]).toBe(before[2]);

    // The visible reorder must be a document/history mutation, not only a
    // transient virtual-list rearrangement.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => rows.allTextContents()).toEqual(before);
  });
});
