import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('docked pane resizing', () => {
  test('resizes the inspector without changing canvas input ownership', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    const handle = page.getByRole('separator', { name: 'Resize inspector panel' });
    const canvas = page.getByTestId('editor-canvas');
    await expect(handle).toBeVisible();
    await expect(canvas).toBeVisible();

    const before = await page
      .locator('#editor-inspector-panel')
      .evaluate((el) => el.getBoundingClientRect().width);
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const after = await page
      .locator('#editor-inspector-panel')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(after).toBeGreaterThan(before + 40);
    await expect(canvas).toBeVisible();
    await expect(handle).toHaveCSS('cursor', 'col-resize');
    await page.screenshot({ path: testInfo.outputPath('inspector-resized.png'), fullPage: true });
  });
});
