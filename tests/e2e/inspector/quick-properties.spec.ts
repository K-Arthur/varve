import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Inspector canonical properties', () => {
  test('keeps common selection edits in their canonical sections', async ({ page }) => {
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();
    await page.getByRole('tab', { name: 'Design' }).click();

    await expect(page.getByRole('region', { name: 'Quick properties' })).toHaveCount(0);
    const position = page.getByRole('group', { name: 'Position & Size' });
    await expect(position.getByRole('spinbutton', { name: 'X (px)' })).toHaveCount(1);
    await expect(position.getByRole('spinbutton', { name: 'Y (px)' })).toHaveCount(1);
    await expect(position.getByRole('spinbutton', { name: 'W (px)' })).toHaveCount(1);
    await expect(position.getByRole('spinbutton', { name: 'H (px)' })).toHaveCount(1);
    await expect(page.getByRole('spinbutton', { name: 'Opacity (%)', exact: true })).toHaveCount(1);
    const fills = page.locator('button.insp-disclosure__trigger').filter({ hasText: /^Fill$/ });
    if ((await fills.getAttribute('aria-expanded')) !== 'true') await fills.click();
    await expect(page.getByRole('button', { name: 'Fill colour' })).toBeVisible();

    const x = position.getByRole('spinbutton', { name: 'X (px)' });
    await x.fill('300');
    await x.press('Enter');
    await expect(x).toHaveValue('300');

    await expect(page.locator('.editor-inspector')).toHaveScreenshot('canonical-properties.png', {
      animations: 'disabled',
    });
  });

  test('keeps the canonical sections as the only common property editors', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.getByRole('region', { name: 'Quick properties' })).toHaveCount(0);

    await seedLayers(page, 2);
    const shapes = page.locator('[role="treeitem"][data-layer-type="shape"]');
    await expect(shapes).toHaveCount(2);
    await shapes.first().click();
    await shapes.nth(1).click({ modifiers: ['Control'] });
    await expect(page.getByRole('region', { name: 'Quick properties' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Position & Size' })).toHaveCount(1);
    await expect(page.getByRole('spinbutton', { name: 'Opacity (%)', exact: true })).toHaveCount(1);
  });
});
