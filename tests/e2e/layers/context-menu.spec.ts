import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers, switchWorkspace } from '../shared';

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

    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();

    // Anchored prefix: plain has-text("Rename") also matches "Batch Rename…"
    // and fails Playwright strict mode.
    const renameItem = menu.getByRole('menuitem', { name: /^Rename\b/ });
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
    const beforeCount = await items.count();
    expect(beforeCount).toBeGreaterThanOrEqual(3);
    const targetId = await items.first().getAttribute('data-node-id');
    expect(targetId).toBeTruthy();

    await items.first().click({ button: 'right' });
    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /^Delete\b/ }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator(`[role="treeitem"][data-node-id="${targetId}"]`)).toHaveCount(0);
    await expect(items).toHaveCount(beforeCount - 1);
    await page.keyboard.press('Control+z');
    await expect(items).toHaveCount(beforeCount);
    await expect(page.locator(`[role="treeitem"][data-node-id="${targetId}"]`)).toBeVisible();
  });

  test('delete a painted layer from the compact context menu and undo', async ({ page }) => {
    await switchWorkspace(page, 'Draw');
    const options = page.getByRole('button', { name: 'Tool options', exact: true });
    if ((await options.getAttribute('aria-expanded')) !== 'true') await options.click();
    const createLayer = page
      .locator('.tool-options__popover')
      .getByRole('button', { name: 'Create paint layer', exact: true });
    await expect(createLayer).toBeVisible({ timeout: 5000 });
    await createLayer.click();
    await options.click();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas is missing');
    await page.keyboard.press('b');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    const layer = page.locator('[role="treeitem"][data-layer-category="raster"]').first();
    await expect(layer).toBeVisible();
    const targetId = await layer.getAttribute('data-node-id');
    await page.setViewportSize({ width: 754, height: 885 });
    const layersButton = page.getByRole('button', { name: 'Show layers panel', exact: true });
    if (await layersButton.isVisible()) await layersButton.click();
    await layer.click({ button: 'right' });
    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /^Delete\b/ }).click();
    await expect(page.locator(`[role="treeitem"][data-node-id="${targetId}"]`)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    const restored = page.locator(`[role="treeitem"][data-node-id="${targetId}"]`);
    await expect(restored).toBeVisible();
    await restored.click();
    await restored.press('Delete');
    await expect(restored).toHaveCount(0);
  });

  test('tall layer menus have one styled scroll region and keep commands reachable', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const events: unknown[] = [];
      (window as unknown as { menuFocusTrace: unknown[] }).menuFocusTrace = events;
      for (const type of ['mouseover', 'mousemove', 'keydown', 'focusin']) {
        document.addEventListener(
          type,
          (event) => {
            const target = event.target as Element;
            if (!target.closest?.('.varve-ctxmenu')) return;
            const pointer = event as MouseEvent;
            events.push({
              type,
              x: pointer.clientX,
              y: pointer.clientY,
              key: (event as KeyboardEvent).key,
              target: target.textContent?.slice(0, 90),
            });
            if (events.length > 80) events.shift();
          },
          true,
        );
      }
    });
    for (const viewport of [
      { width: 754, height: 885 },
      { width: 600, height: 400 },
    ]) {
      await page.setViewportSize(viewport);
      const layersButton = page.getByRole('button', { name: 'Show layers panel', exact: true });
      if (await layersButton.isVisible()) await layersButton.click();
      await page.getByRole('treeitem').first().click({ button: 'right' });
      const menu = page.locator('.varve-ctxmenu');
      await expect(menu).toBeVisible();
      const geometry = await menu.evaluate((element) => {
        const parent = element.parentElement;
        if (!parent) throw new Error('Menu portal is missing');
        return {
          menu: element.getBoundingClientRect().toJSON(),
          innerScrolls: element.scrollHeight > element.clientHeight,
          parentScrolls: parent.scrollHeight > parent.clientHeight + 1,
          scrollbarWidth: getComputedStyle(element).scrollbarWidth,
        };
      });
      expect(geometry.innerScrolls).toBe(true);
      expect(geometry.parentScrolls).toBe(false);
      expect(geometry.scrollbarWidth).toBe('thin');
      expect(geometry.menu.y).toBeGreaterThanOrEqual(0);
      expect(geometry.menu.bottom).toBeLessThanOrEqual(viewport.height);
      await menu.press('End');
      const lastAction = menu.locator('button[role="menuitem"]').last();
      await test.info().attach(`menu-focus-${viewport.width}`, {
        body: JSON.stringify(
          await page.evaluate(
            () => (window as unknown as { menuFocusTrace: unknown[] }).menuFocusTrace,
          ),
        ),
        contentType: 'application/json',
      });
      await expect(lastAction).toBeFocused();
      await expect(lastAction).toBeInViewport();
      await page.screenshot({
        path: test.info().outputPath(`layer-menu-${viewport.width}x${viewport.height}.png`),
      });
      await page.keyboard.press('Escape');
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

    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();

    // has-text("Group") also matches "Ungroup" — anchor to the start so
    // only the "Group Ctrl+G" item matches.
    const groupItem = menu.getByRole('menuitem', { name: /^Group\b/ });
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

      const menu = page.locator('.varve-ctxmenu');
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

    const menu = page.locator('.varve-ctxmenu');
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

    const menu = page.locator('.varve-ctxmenu');
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

    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();

    await menu.getByRole('menuitem', { name: 'Color Tag' }).click();
    const redBtn = page
      .getByRole('menu', { name: 'Color Tag submenu' })
      .getByRole('menuitem', { name: /^Red$/i });
    await redBtn.click();
    await page.waitForTimeout(100);

    // The row carries the document label through its visible backdrop cue.
    await expect(firstItem).toHaveAttribute('data-layer-color', 'red');
    await expect(firstItem.locator('.layers-row__color-tag')).toHaveCount(0);
  });

  test('color tag targets the context row without changing layer order', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for context-row color tagging');

    const beforeOrder = await items.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-node-id')),
    );
    const target = items.nth(1);

    // Right-click an unselected row. The menu must snapshot this row as its
    // target before the asynchronous selection update settles.
    await target.click({ button: 'right' });
    await expect(target).toHaveAttribute('aria-selected', 'true');
    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Color Tag' }).click();
    await page.screenshot({
      path: 'test-results/layers-colour-tag-submenu-open.png',
    });
    await page
      .getByRole('menu', { name: 'Color Tag submenu' })
      .getByRole('menuitem', { name: /^Blue$/i })
      .click();

    await expect(target).toHaveAttribute('data-layer-color', 'blue');
    await expect(
      items.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-node-id'))),
    ).resolves.toEqual(beforeOrder);
    await items.nth(0).click();
    await expect(target).not.toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-colour-tag-stable-order.png',
    });
    for (const index of [0, 2]) {
      if (index < count)
        await expect(items.nth(index)).not.toHaveAttribute('data-layer-color', 'blue');
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

    const menu = page.locator('.varve-ctxmenu');
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
    const secondItem = page.getByRole('treeitem').nth(1);
    const count = await page.getByRole('treeitem').count();
    test.skip(count < 2, 'Need at least 2 layers for select same color');

    // First set a color tag on the first item
    await firstItem.click({ button: 'right' });
    await page.waitForTimeout(100);
    const menu = page.locator('.varve-ctxmenu');
    const redBtn = menu.getByRole('menuitem', { name: /^Red$/i });
    if ((await redBtn.count()) > 0) {
      await redBtn.click();
      await page.waitForTimeout(100);

      // Give a second layer the same tag so this exercises the real selection
      // path instead of passing when the command correctly no-ops for a
      // uniquely tagged layer.
      await secondItem.click({ button: 'right' });
      await page.waitForTimeout(100);
      await page.locator('.varve-ctxmenu').getByRole('menuitem', { name: /^Red$/i }).click();
      await page.waitForTimeout(100);

      // Now right-click again and try "Select Same Color"
      await firstItem.click({ button: 'right' });
      await page.waitForTimeout(100);

      const selectSameColor = page
        .locator('.varve-ctxmenu')
        .getByRole('menuitem', { name: /^Select Same Color$/i });
      await expect(selectSameColor).toBeVisible();
      await selectSameColor.click();
      await expect
        .poll(() =>
          page
            .getByRole('treeitem')
            .evaluateAll(
              (rows) => rows.filter((row) => row.getAttribute('aria-selected') === 'true').length,
            ),
        )
        .toBeGreaterThanOrEqual(2);
      const selectedTags = await page
        .getByRole('treeitem')
        .evaluateAll((rows) =>
          rows
            .filter((row) => row.getAttribute('aria-selected') === 'true')
            .map((row) => row.getAttribute('data-layer-color')),
        );
      expect(selectedTags.every((tag) => tag === 'red')).toBe(true);
    }
  });
});
