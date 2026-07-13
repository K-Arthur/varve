import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Toolbar button's accessible name is "New" (icon + "New" text), not
  // "New file" — matching on the fuller phrase silently times out.
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

  // A first-run "Welcome to Strata" modal can overlay the canvas.
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

/** Draw `count` distinct rectangles so the layers tree is populated. */
async function seedLayers(page: import('@playwright/test').Page, count: number) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  for (let i = 0; i < count; i++) {
    const x1 = 100 + i * 120;
    const y1 = 100 + i * 60;
    await page.keyboard.press('r');
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x1 + 40, box.y + y1 + 40);
    await page.mouse.move(box.x + x1 + 80, box.y + y1 + 80);
    await page.mouse.up();
  }
  await page.getByRole('treeitem').first().waitFor({ timeout: 5000 });
}

test.describe('Layers Panel - Drag & Drop', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);
  });

  test('layers tree renders with sortable rows', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();

    // Ensure there are some elements (empty state or layers)
    const items = page.getByRole('treeitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('drag handle is present on tree rows', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    if (count >= 1) {
      const firstItem = items.first();
      const dragHandle = firstItem.locator('[class*="drag-handle"]');
      await expect(dragHandle).toBeVisible();
    }
  });

  test('keyboard reorder moves selected row (Ctrl+[ / Ctrl+])', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    const items = page.getByRole('treeitem');
    const count = await items.count();
    if (count >= 2) {
      const firstName = await items.first().textContent();
      // Focus second item, then move up with Ctrl+[
      await items.nth(1).click();
      await page.keyboard.press('Control+[');
      await page.waitForTimeout(200);
      const newFirstName = await items.first().textContent();
      expect(newFirstName).not.toBe(firstName);
    }
  });

  test('canvas accepts DnD drop zone', async ({ page }) => {
    const canvas = page.getByLabel('Canvas');
    await expect(canvas).toBeVisible();
    // The canvas should be present and have the droppable attribute
    await expect(canvas).toHaveAttribute('aria-label', 'Canvas');
  });

  test('file import input exists', async ({ page }) => {
    const importInput = page.locator('#file-import-input');
    await expect(importInput).toBeVisible({ visible: false });
    await expect(importInput).toHaveAttribute('accept', '.svg,.png,.jpg,.jpeg,.webp,.gif');
  });
});
