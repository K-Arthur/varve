import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function drawRectangle(
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
  await page.mouse.move(canvas.x + x + width, canvas.y + y + height, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('v');
}

test.describe('Shape Builder workflow', () => {
  test('selects a swept region set, creates a retained editable result, and undoes it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not found');

    await drawRectangle(page, box, 120, 140, 140, 100);
    await drawRectangle(page, box, 200, 180, 140, 100);
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    await page.screenshot({
      path: testInfo.outputPath('before-shape-builder.png'),
      fullPage: true,
    });

    await canvas.click({ position: { x: 150, y: 170 } });
    await page.keyboard.down('Shift');
    await canvas.click({ position: { x: 280, y: 240 } });
    await page.keyboard.up('Shift');

    const toolbar = page.getByTestId('toolbar');
    await expect(toolbar.getByRole('button', { name: 'Shape Builder', exact: true })).toBeVisible();
    await toolbar.getByRole('button', { name: 'Shape Builder', exact: true }).click();
    await expect(page.getByTestId('shape-builder-controls')).toBeVisible();

    // A single pointer sweep crosses the left, overlap, and right faces. The
    // endpoints are deliberately in the outer faces so this catches thin-face
    // skipping and sampled-point-only implementations.
    await page.mouse.move(box.x + 150, box.y + 205);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 205, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId('shape-builder-status')).toContainText('3 regions selected');
    await page.screenshot({
      path: testInfo.outputPath('during-shape-builder.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Create selected regions' }).click();
    await expect(page.getByTestId('shape-builder-controls')).toHaveCount(0);
    await expect(page.getByRole('treeitem')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('after-shape-builder.png'), fullPage: true });

    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem')).toHaveCount(3);

    await page.getByRole('button', { name: 'Node Edit', exact: true }).click();
    await expect(
      page.locator('svg').filter({ has: page.locator('title', { hasText: 'Node edit overlay' }) }),
    ).toBeVisible();
  });
});
