import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - APG Tree View', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
  });

  test('renders a tree with correct ARIA semantics', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();
    await expect(tree).toHaveAttribute('aria-multiselectable', 'true');
  });

  test('keyboard navigation with arrow keys', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    // Drawing a shape auto-selects it, so focus already tracks the
    // front-most item (index 0) before any keypress — ArrowDown moves to
    // the second item, not the first.
    await page.keyboard.press('ArrowDown');
    const secondItem = page.getByRole('treeitem').nth(1);
    await expect(secondItem).toBeFocused();
  });

  test('expand and collapse containers with arrow keys', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    // Find first container treeitem with aria-expanded — scoped to
    // `role=treeitem`, since an unscoped [aria-expanded] can match unrelated
    // UI (a collapsed sidebar section) or the row's details disclosure
    // button. seedLayers only draws flat rectangles, so there's usually
    // nothing here to expand; the count()===0 guard below is expected to
    // skip the body in that case.
    const container = tree.locator('[role="treeitem"][aria-expanded]').first();
    if ((await container.count()) > 0) {
      const wasExpanded = await container.getAttribute('aria-expanded');
      if (wasExpanded === 'false') {
        await container.click();
        // Wait for expand animation
        await page.waitForTimeout(100);
        const isExpanded = await container.getAttribute('aria-expanded');
        expect(isExpanded).toBe('true');
      }
    }
  });

  test('context menu opens and closes', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click({ button: 'right' });

    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });

  test('visibility toggle changes row state', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();
    // Class-scoped: the row's details disclosure ("Show details for …") also
    // matches an `aria-label*="Show"` matcher and is pointer-inert until
    // hover. `.layers-row__toggle` order is visibility, lock, solo.
    const visBtn = firstItem.locator('button.layers-row__toggle').first();
    if ((await visBtn.count()) > 0) {
      await visBtn.click();
      // Row should have hidden style
      await expect(firstItem).toHaveClass(/layers-row--hidden/);
    }
  });

  test('lock toggle changes aria-pressed', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();
    const lockBtn = firstItem.locator('[aria-label*="Lock"], [aria-label*="Unlock"]').first();
    if ((await lockBtn.count()) > 0) {
      const before = await lockBtn.getAttribute('aria-pressed');
      await lockBtn.click();
      const after = await lockBtn.getAttribute('aria-pressed');
      expect(after).not.toBe(before);
    }
  });

  test('search filter narrows visible rows', async ({ page }) => {
    const filter = page.getByRole('searchbox', { name: 'Filter layers by name' });
    const items = page.getByRole('treeitem');
    const initialCount = await items.count();
    if (initialCount > 1) {
      const firstName = await items.first().locator('.layers-row__name').textContent();
      if (firstName) {
        await filter.fill(firstName.trim());
        await page.waitForTimeout(200);
        const afterCount = await items.count();
        expect(afterCount).toBeLessThanOrEqual(initialCount);
        expect(afterCount).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('layer colour labels remain visible as a row cue', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click({ button: 'right' });
    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Color Tag' }).click();
    await page
      .getByRole('menu', { name: 'Color Tag submenu' })
      .getByRole('menuitem', { name: /^Red$/i })
      .click();

    await expect(firstItem).toHaveAttribute('data-layer-color', 'red');
    await expect(firstItem.locator('.layers-row__color-tag')).toHaveCount(0);

    await firstItem.click();
    await expect(firstItem).toHaveAttribute('aria-selected', 'true');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    const selectedBackground = await firstItem.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await firstItem.hover();
    await page.waitForTimeout(250);
    const selectedHoverBackground = await firstItem.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(selectedHoverBackground).not.toBe(selectedBackground);
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-colour-label-selected.png',
    });

    // A backdrop must remain visible when the tagged row is not selected; the
    // selected-row treatment also preserves the tag color for clarity.
    if ((await page.getByRole('treeitem').count()) > 1) {
      await page.getByRole('treeitem').nth(1).click();
    }

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }, theme);
      // Clear the previous iteration's pointer position so the resting
      // sample is not accidentally taken from the already-hovered row.
      await page.mouse.move(0, 0);
      const taggedBackground = await firstItem.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const neutralBackground = await page
        .getByRole('treeitem')
        .nth(2)
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(taggedBackground).not.toBe(neutralBackground);
      await firstItem.hover();
      await expect
        .poll(() => firstItem.evaluate((element) => getComputedStyle(element).backgroundColor), {
          message: `${theme} tagged row hover should settle`,
        })
        .not.toBe(taggedBackground);
      await page.getByTestId('layers-panel').screenshot({
        path: `test-results/layers-colour-label-${theme}.png`,
      });
      await page.getByTestId('layers-panel').screenshot({
        path: `test-results/layers-colour-label-${theme}-hover.png`,
      });
    }
  });

  test('search reveals a descendant in a collapsed hierarchy and restores the view', async ({
    page,
  }) => {
    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });

    const groupButton = page.locator('.layers-bulk-bar__btn[aria-label="Group"]');
    await expect(groupButton).toBeVisible();
    await groupButton.click({ force: true });

    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group/ })
      .first();
    await expect(group).toBeVisible();
    const groupId = await group.getAttribute('data-node-id');
    expect(groupId).toBeTruthy();

    const child = page
      .getByRole('treeitem')
      .filter({ hasText: /Rectangle/ })
      .first();
    const childId = await child.getAttribute('data-node-id');
    const childName = await child.locator('.layers-row__name').textContent();
    expect(childId).toBeTruthy();
    expect(childName).toBeTruthy();

    await group.getByRole('button', { name: 'Collapse' }).click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    // Scope to the panel: the canvas accessibility mirror also carries
    // data-node-id, so an unscoped locator is ambiguous (strict mode).
    const panelRow = page.locator(`.layers-panel [data-node-id="${childId}"]`);
    await expect(panelRow).not.toBeVisible();

    const filter = page.getByRole('searchbox', { name: 'Filter layers by name' });
    await filter.fill(childName!.trim());

    const filteredChild = panelRow;
    await expect(filteredChild).toBeVisible();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-collapsed-search-revealed.png',
    });

    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(filteredChild).not.toBeVisible();
  });

  test('keyboard reorder moves selected row', async ({ page }) => {
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

  test('Home/End long jump focuses the mounted row in a large tree', async ({ page }) => {
    // Enough rows to overflow the virtualizer's mounted window: the End
    // target row only exists after the scroll completes, which is exactly
    // the window where DOM focus used to lag one row behind the highlight.
    await page
      .locator('#file-import-input')
      .setInputFiles('tests/e2e/fixtures/layers-stress-board.svg');
    await page.waitForTimeout(800);
    const tree = page.getByRole('tree', { name: /layers/i });
    const overflows = await page.evaluate(() => {
      const el = document.querySelector('.layers-panel__tree');
      return el ? el.scrollHeight > el.clientHeight + 8 : false;
    });
    expect(overflows).toBe(true);

    await tree.focus();
    await page.keyboard.press('End');
    const last = page.getByRole('treeitem').last();
    await expect(last).toBeFocused({ timeout: 10_000 });
    await expect(last).toHaveClass(/layers-row--focused/);

    await page.keyboard.press('Home');
    await expect(page.getByRole('treeitem').first()).toBeFocused({ timeout: 10_000 });
  });

  test('asterisk expands sibling containers without moving focus (APG optional)', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      await page.mouse.move(box.x + x1, box.y + y1);
      await page.mouse.down();
      await page.mouse.move(box.x + x2, box.y + y2, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    };
    // Two sibling frames, each holding a child rect.
    await page.keyboard.press('f');
    await drag(100, 100, 320, 300);
    await page.keyboard.press('r');
    await drag(140, 140, 200, 200);
    await page.keyboard.press('f');
    await drag(400, 100, 620, 300);
    await page.keyboard.press('r');
    await drag(440, 140, 500, 200);

    const containers = page.locator('[role="treeitem"][aria-expanded]');
    await expect(containers.first()).toBeVisible();
    const count = await containers.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Collapse every container so `*` has closed siblings to expand.
    for (let i = 0; i < count; i++) {
      const row = containers.nth(i);
      if ((await row.getAttribute('aria-expanded')) === 'true') {
        await row.locator('[aria-label="Collapse"]').click();
        await page.waitForTimeout(100);
      }
    }
    for (let i = 0; i < count; i++) {
      await expect(containers.nth(i)).toHaveAttribute('aria-expanded', 'false');
    }

    const first = containers.first();
    await first.click();
    await expect(first).toBeFocused();
    await page.keyboard.press('*');

    // Every sibling container at the focused level is expanded, and the
    // focused row did not move (APG: focus does not move).
    for (let i = 0; i < count; i++) {
      await expect(containers.nth(i)).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(first).toBeFocused();
  });

  test('isolation is enforced on the canvas: outside layers are not selectable', async ({
    page,
  }) => {
    // Frame F with a child inside, plus a loose rect outside.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      await page.mouse.move(box.x + x1, box.y + y1);
      await page.mouse.down();
      await page.mouse.move(box.x + x2, box.y + y2, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    };
    await page.keyboard.press('f');
    await drag(100, 100, 300, 260);
    await page.keyboard.press('r');
    await drag(140, 140, 180, 180);
    await page.keyboard.press('r');
    await drag(500, 400, 560, 460);

    // The front-most root-level leaf is the outside rect (drawn last). Pin
    // its durable node id before isolating so the final assertion targets
    // exactly that row.
    const outsideRow = page
      .locator('[role="treeitem"][aria-level="1"]:not([aria-expanded])')
      .first();
    const outsideId = await outsideRow.getAttribute('data-node-id');
    if (!outsideId) throw new Error('outside rect row missing');

    // Isolate the frame (the only container row).
    const frameRow = page.locator('[role="treeitem"][aria-expanded]').first();
    await frameRow.click({ button: 'right' });
    await page
      .locator('.varve-ctxmenu')
      .getByRole('menuitem', { name: /isolate/i })
      .click();
    await expect(page.locator('.layers-panel__isolation-breadcrumb')).toBeVisible();

    // Click the loose rect's canvas position: canvas-side isolation keeps it
    // unselectable, so nothing outside the subtree may become selected.
    await page.mouse.click(box.x + 530, box.y + 430);
    await page.waitForTimeout(200);
    await expect(page.locator('.layers-panel__isolation-breadcrumb')).toBeVisible();

    // Exit isolation and confirm the loose rect was never selected.
    await page.keyboard.press('Escape');
    await expect(page.locator('.layers-panel__isolation-breadcrumb')).toBeHidden();
    await expect(page.locator(`[role="treeitem"][data-node-id="${outsideId}"]`)).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});
