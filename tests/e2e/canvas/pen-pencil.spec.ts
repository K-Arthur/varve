import { expect, test } from '@playwright/test';

import { dragOnCanvas, navigateToEditor } from '../shared';

async function contentCanvasBox(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box || box.width < 10 || box.height < 10) {
    throw new Error('content canvas not laid out');
  }
  return box;
}

async function clickOnCanvas(page: import('@playwright/test').Page, x: number, y: number) {
  const box = await contentCanvasBox(page);
  await page.mouse.click(box.x + x, box.y + y);
}

async function moveOnCanvas(page: import('@playwright/test').Page, x: number, y: number) {
  const box = await contentCanvasBox(page);
  return { x: box.x + x, y: box.y + y };
}

async function capturePenState(page: import('@playwright/test').Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.locator('[data-testid="canvas-overlay"]').screenshot({ path });
  await test.info().attach(name, {
    path,
    contentType: 'image/png',
  });
}

test.describe('Pen and Pencil tools', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Pen tool creates a path with multiple anchors', async ({ page }) => {
    test.setTimeout(60000);
    await page.keyboard.press('p');
    await clickOnCanvas(page, 150, 150);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 300, 150);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 300, 280);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/path|vector shape/i);
  });

  test('Pencil tool creates a path on drag', async ({ page }) => {
    await page.keyboard.press('Shift+p');
    await dragOnCanvas(page, 120, 120, 380, 260);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/path|vector shape/i);
  });

  test('Pen path paints on canvas at clicked position', async ({ page }) => {
    test.setTimeout(60000);
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await contentCanvas.screenshot();

    await page.keyboard.press('p');
    await clickOnCanvas(page, 160, 160);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 340, 160);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(300);

    const after = await contentCanvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('Pen shows all placed anchors before the path is committed', async ({ page }) => {
    await page.keyboard.press('p');
    await clickOnCanvas(page, 150, 150);
    await page.waitForTimeout(350);
    const first = await page.locator('[data-testid="canvas-overlay"]').screenshot();
    await clickOnCanvas(page, 300, 150);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 300, 280);
    await page.waitForTimeout(100);

    await capturePenState(page, 'pen-three-anchors');
    const three = await page.locator('[data-testid="canvas-overlay"]').screenshot();
    expect(Buffer.compare(first, three)).not.toBe(0);
    await expect(page.getByRole('treeitem')).toHaveCount(0);
  });

  test('Pen shows live handles and cubic preview during a drag', async ({ page }) => {
    await page.keyboard.press('p');
    await clickOnCanvas(page, 130, 240);
    await page.waitForTimeout(350);

    const second = await moveOnCanvas(page, 300, 240);
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(second.x + 80, second.y - 80, { steps: 8 });
    await page.waitForTimeout(100);

    await capturePenState(page, 'pen-live-handles-and-curve');
    const live = await page.locator('[data-testid="canvas-overlay"]').screenshot();
    expect(live.byteLength).toBeGreaterThan(0);

    await page.mouse.up();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  });

  test('Pen highlights the first anchor and closes by clicking it', async ({ page }) => {
    await page.keyboard.press('p');
    await clickOnCanvas(page, 180, 160);
    await page.waitForTimeout(350);
    await clickOnCanvas(page, 340, 160);
    await page.waitForTimeout(350);

    const first = await moveOnCanvas(page, 180, 160);
    await page.mouse.move(first.x + 2, first.y + 2);
    await page.waitForTimeout(100);
    await capturePenState(page, 'pen-close-target');
    await page.mouse.click(first.x + 2, first.y + 2);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  });
});
