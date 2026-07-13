import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });

  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 10000 });
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box && box.width > 10 && box.height > 10;
    })
    .toBe(true);
}

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

async function dragOnCanvas(
  page: import('@playwright/test').Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const box = await contentCanvasBox(page);
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2);
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
}

test.describe('Pen and Pencil tools', () => {
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
    await expect(page.getByRole('treeitem').first()).toContainText(/path/i);
  });

  test('Pencil tool creates a path on drag', async ({ page }) => {
    await page.keyboard.press('Shift+p');
    await dragOnCanvas(page, 120, 120, 380, 260);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/path/i);
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
});
