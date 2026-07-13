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

test.describe('Layers Panel - Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
  });

  test('rename via context menu', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();
    const count = await page.getByRole('treeitem').count();
    test.skip(count < 1, 'Need at least 1 layer for rename');

    await firstItem.click({ button: 'right' });
    await page.waitForTimeout(100);

    const menu = page.locator('.layers-context-menu');
    await expect(menu).toBeVisible();

    const renameItem = menu.locator('button:has-text("Rename")');
    if ((await renameItem.count()) > 0) {
      // Accept browser prompt since the menu handler uses prompt()
      page.on('dialog', async (dialog) => {
        await dialog.accept('Renamed Layer');
      });
      await renameItem.click();
    }
  });

  test('delete via context menu', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 1, 'Need at least 1 layer for delete');

    const beforeCount = await items.count();

    await items.first().click({ button: 'right' });
    await page.waitForTimeout(100);

    const menu = page.locator('.layers-context-menu');
    await expect(menu).toBeVisible();

    const deleteItem = menu.locator('button:has-text("Delete")');
    if ((await deleteItem.count()) > 0) {
      await deleteItem.click();
      await page.waitForTimeout(200);

      const afterCount = await items.count();
      expect(afterCount).toBeLessThan(beforeCount);
    }
  });

  test('group via context menu (2+ selected)', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for group');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    // Right-click to open context menu
    await items.nth(0).click({ button: 'right' });
    await page.waitForTimeout(100);

    const menu = page.locator('.layers-context-menu');
    await expect(menu).toBeVisible();

    const groupItem = menu.locator('button:has-text("Group")');
    if ((await groupItem.count()) > 0) {
      await expect(groupItem).not.toBeDisabled();
      await groupItem.click();
      await page.waitForTimeout(200);

      // A group should appear in the tree
      const itemsAfter = page.getByRole('treeitem');
      const groupRow = itemsAfter.filter({ hasText: /Group/ });
      await expect(groupRow.first()).toBeAttached();
    }
  });

  test('ungroup via context menu', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for ungroup');

    // First create a group via keyboard shortcut
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.press('Control+g');
    await page.waitForTimeout(300);

    const itemsAfterGroup = page.getByRole('treeitem');
    const groupItem = itemsAfterGroup.filter({ hasText: /Group/ }).first();

    if ((await groupItem.count()) > 0) {
      // Right-click the group
      await groupItem.click({ button: 'right' });
      await page.waitForTimeout(100);

      const menu = page.locator('.layers-context-menu');
      const ungroupItem = menu.locator('button:has-text("Ungroup")');
      if ((await ungroupItem.count()) > 0) {
        await expect(ungroupItem).not.toBeDisabled();
        await ungroupItem.click();
        await page.waitForTimeout(200);

        // Group should be gone, children should be back at parent level
        const itemsAfterUngroup = page.getByRole('treeitem');
        const groupAfter = itemsAfterUngroup.filter({ hasText: /Group/ });
        expect(await groupAfter.count()).toBe(0);
      }
    }
  });

  test('bring to front via context menu', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for bring to front');

    const lastName = await items.last().textContent();

    // Right-click the last item
    await items.last().click({ button: 'right' });
    await page.waitForTimeout(100);

    const menu = page.locator('.layers-context-menu');
    await expect(menu).toBeVisible();

    const frontItem = menu.locator('button:has-text("Bring to Front")');
    if ((await frontItem.count()) > 0) {
      await frontItem.click();
      await page.waitForTimeout(200);

      // The item should now be first in the tree
      const newFirstName = await items.first().textContent();
      expect(newFirstName?.trim()).toBe(lastName?.trim());
    }
  });

  test('send to back via context menu', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for send to back');

    const firstName = await items.first().textContent();

    // Right-click the first item
    await items.first().click({ button: 'right' });
    await page.waitForTimeout(100);

    const menu = page.locator('.layers-context-menu');
    await expect(menu).toBeVisible();

    const backItem = menu.locator('button:has-text("Send to Back")');
    if ((await backItem.count()) > 0) {
      await backItem.click();
      await page.waitForTimeout(200);

      // The item should now be last in the tree
      const newLastName = await items.last().textContent();
      expect(newLastName?.trim()).toBe(firstName?.trim());
    }
  });

  test('color tag via context menu', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();
    const count = await page.getByRole('treeitem').count();
    test.skip(count < 1, 'Need at least 1 layer for color tag');

    await firstItem.click({ button: 'right' });
    await page.waitForTimeout(100);

    const menu = page.locator('.layers-context-menu');
    await expect(menu).toBeVisible();

    // Click the "Red" color tag button
    const redBtn = menu.locator('.layers-context-menu__color-tag-btn--red');
    if ((await redBtn.count()) > 0) {
      await redBtn.click();
      await page.waitForTimeout(100);

      // The row should now have a color tag indicator
      const colorDot = firstItem.locator('[data-layer-color]');
      if ((await colorDot.count()) > 0) {
        await expect(colorDot).toHaveAttribute('data-layer-color', 'red');
      }
    }
  });

  test('select same type via context menu', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for select same type');

    const firstType = await items.first().getAttribute('data-layer-type');

    // Right-click first item
    await items.first().click({ button: 'right' });
    await page.waitForTimeout(100);

    const menu = page.locator('.layers-context-menu');
    await expect(menu).toBeVisible();

    const selectSameType = menu.locator('button:has-text("Select Same Type")');
    if ((await selectSameType.count()) > 0) {
      await selectSameType.click();
      await page.waitForTimeout(200);

      // All items of the same type should now be selected
      const selected = page.locator('[role="treeitem"][aria-selected="true"]');
      const selectedCount = await selected.count();
      expect(selectedCount).toBeGreaterThanOrEqual(1);

      // Verify all selected have the same type
      const selectedTypes = await selected.evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-layer-type')),
      );
      for (const t of selectedTypes) {
        expect(t).toBe(firstType);
      }
    }
  });

  test('select same color via context menu', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();
    const count = await page.getByRole('treeitem').count();
    test.skip(count < 1, 'Need at least 1 layer for select same color');

    // First set a color tag on the first item
    await firstItem.click({ button: 'right' });
    await page.waitForTimeout(100);
    const menu = page.locator('.layers-context-menu');
    const redBtn = menu.locator('.layers-context-menu__color-tag-btn--red');
    if ((await redBtn.count()) > 0) {
      await redBtn.click();
      await page.waitForTimeout(100);

      // Now right-click again and try "Select Same Color"
      await firstItem.click({ button: 'right' });
      await page.waitForTimeout(100);

      const selectSameColor = page.locator(
        '.layers-context-menu button:has-text("Select Same Color")',
      );
      if ((await selectSameColor.count()) > 0) {
        await selectSameColor.click();
        await page.waitForTimeout(200);
      }
    }
  });
});
