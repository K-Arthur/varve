import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Inspector feature ownership', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('tabs use roving focus and document settings have one canonical home', async ({ page }) => {
    const properties = page.getByRole('tab', { name: 'Properties' });
    const appearance = page.getByRole('tab', { name: 'Appearance' });

    await properties.focus();
    await page.keyboard.press('ArrowRight');
    await expect(appearance).toBeFocused();
    await expect(appearance).toHaveAttribute('aria-selected', 'true');

    await properties.click();
    await expect(page.getByRole('button', { name: 'Canvas', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Document' }).click();
    await expect(page.getByRole('button', { name: 'Canvas', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Document Color' })).toBeVisible();
  });

  test('prototype authoring is discoverable without living in Properties', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();

    await page.getByRole('tab', { name: 'Properties' }).click();
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Prototype' }).click();
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toBeVisible();
  });

  test('a common shape stays within the contextual inspector DOM budget', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();
    await page.getByRole('tab', { name: 'Properties' }).click();

    const metrics = await page.locator('.editor-inspector').evaluate((element) => ({
      descendants: element.querySelectorAll('*').length,
      scrollHeight: element.scrollHeight,
      viewportHeight: element.clientHeight,
    }));

    expect(metrics.descendants).toBeLessThanOrEqual(240);
    expect(metrics.scrollHeight / metrics.viewportHeight).toBeLessThanOrEqual(1.75);
    await expect(page.getByRole('button', { name: 'Effects' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toHaveCount(0);
  });

  test('brush behavior opens from Tool Options instead of Properties', async ({ page }) => {
    await page.getByRole('radio', { name: 'Draw', exact: true }).click();
    await page.keyboard.press('b');
    await page.getByRole('button', { name: 'Tool options' }).click();

    const dialog = page.getByRole('dialog', { name: 'paint tool options' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Brush' })).toBeVisible();
  });

  test('responsive inspector drawer is inside the viewport when opened', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.getByRole('button', { name: 'Show inspector panel' }).click();

    const panel = page.locator('.editor__inspector-panel');
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.ceil(box.x + box.width) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(800);
  });
});
