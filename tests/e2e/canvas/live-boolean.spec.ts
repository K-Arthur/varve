import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function createRect(
  page: import('@playwright/test').Page,
  canvas: { x: number; y: number },
  x: number,
  y: number,
  width: number,
  height: number,
) {
  await page.keyboard.press('r');
  await page.mouse.move(canvas.x + x, canvas.y + y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + x + width, canvas.y + y + height, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('v');
}

test.describe('live Boolean workflow', () => {
  test('creates, changes, expands, and undoes a live Boolean through the editor UI', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not found');

    await createRect(page, box, 120, 140, 140, 100);
    await createRect(page, box, 200, 180, 140, 100);
    await expect(page.getByRole('treeitem')).toHaveCount(2);

    // Select each exposed filled region, then use the actual Pathfinder action.
    await canvas.click({ position: { x: 150, y: 170 } });
    await page.keyboard.down('Shift');
    await canvas.click({ position: { x: 280, y: 240 } });
    await page.keyboard.up('Shift');
    await page.getByLabel('Boolean Union').click();

    const layers = page.getByRole('tree', { name: /layers/i });
    await expect(layers.getByText('Boolean Union')).toBeVisible();

    // The contextual menu exposes non-destructive operation editing.
    await canvas.click({ button: 'right', position: { x: 225, y: 205 } });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Change Boolean to Subtract' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Change Boolean to Subtract' }).click();
    await expect(layers.getByText('Boolean Subtract')).toBeVisible();

    // Expand is explicit and undo restores the editable live operands.
    await canvas.click({ button: 'right', position: { x: 160, y: 170 } });
    await expect(menu.getByRole('menuitem', { name: 'Expand Boolean' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Expand Boolean' }).click();
    await expect(layers.getByText('Boolean Subtract')).toBeVisible();

    // The expanded shape retains the readable Boolean name, but it no longer
    // carries live state, so its menu cannot offer another expansion.
    await canvas.click({ button: 'right', position: { x: 160, y: 170 } });
    await expect(menu.getByRole('menuitem', { name: 'Expand Boolean' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+z');
    await canvas.click({ button: 'right', position: { x: 160, y: 170 } });
    await expect(menu.getByRole('menuitem', { name: 'Expand Boolean' })).toBeVisible();
  });
});
