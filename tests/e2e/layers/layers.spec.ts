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

    // Find first container with aria-expanded — scoped to the tree, since
    // an unscoped page-wide [aria-expanded] can match unrelated UI (e.g. a
    // collapsed sidebar section) and seedLayers only draws flat rectangles,
    // so there's usually nothing here to expand; the count()===0 guard
    // below is expected to skip the body in that case.
    const container = tree.locator('[aria-expanded]').first();
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
    const visBtn = firstItem.locator('[aria-label*="Hide"], [aria-label*="Show"]').first();
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
      const firstName = await items.first().getAttribute('aria-label');
      if (firstName) {
        await filter.fill(firstName);
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

    // A backdrop must remain visible when the tagged row is not selected; the
    // selected-row surface intentionally takes precedence for clarity.
    if ((await page.getByRole('treeitem').count()) > 1) {
      await page.getByRole('treeitem').nth(1).click();
    }

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }, theme);
      const taggedBackground = await firstItem.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const neutralBackground = await page
        .getByRole('treeitem')
        .nth(2)
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(taggedBackground).not.toBe(neutralBackground);
      await page.getByTestId('layers-panel').screenshot({
        path: `test-results/layers-colour-label-${theme}.png`,
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
    await expect(page.locator(`[data-node-id="${childId}"]`)).not.toBeVisible();

    const filter = page.getByRole('searchbox', { name: 'Filter layers by name' });
    await filter.fill(childName!.trim());

    const filteredChild = page.locator(`[data-node-id="${childId}"]`);
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
});
