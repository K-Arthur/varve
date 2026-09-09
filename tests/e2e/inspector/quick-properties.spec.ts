import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Inspector quick properties', () => {
  test('keeps common selection edits visible and connected to the canonical sections', async ({
    page,
  }) => {
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

    const quickBar = page.getByRole('region', { name: 'Quick properties' });
    await expect(quickBar).toBeVisible();
    await expect(quickBar.getByRole('spinbutton', { name: 'X (px)' })).toHaveCount(1);
    await expect(quickBar.getByRole('spinbutton', { name: 'Y (px)' })).toHaveCount(1);
    await expect(quickBar.getByRole('spinbutton', { name: 'Width (px)' })).toHaveCount(1);
    await expect(quickBar.getByRole('spinbutton', { name: 'Height (px)' })).toHaveCount(1);
    await expect(quickBar.getByRole('spinbutton', { name: 'Opacity' })).toHaveCount(1);
    await expect(quickBar.getByRole('button', { name: 'Primary fill colour' })).toBeVisible();

    const quickX = quickBar.getByRole('spinbutton', { name: 'X (px)' });
    await quickX.fill('300');
    await quickX.press('Enter');
    await expect(
      page.getByRole('group', { name: 'Layout' }).getByRole('spinbutton', { name: 'X (px)' }),
    ).toHaveValue('300');

    await expect(quickBar).toHaveScreenshot('quick-properties.png', {
      animations: 'disabled',
    });
  });

  test('does not add a single-selection bar to empty or mixed selection states', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await expect(page.getByRole('region', { name: 'Quick properties' })).toHaveCount(0);

    await seedLayers(page, 2);
    const shapes = page.locator('[role="treeitem"][data-layer-type="shape"]');
    await expect(shapes).toHaveCount(2);
    await shapes.first().click();
    await shapes.nth(1).click({ modifiers: ['Control'] });
    await expect(page.getByRole('region', { name: 'Quick properties' })).toHaveCount(0);
  });
});
