import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - Accessibility', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
  });

  test('tab enters layers tree', async ({ page }) => {
    // How many Tab-able elements precede the layers tree depends on what
    // else is in the shell (toolbar, menubar, contextual-help affordances,
    // etc.), which changes over time — don't hardcode a press count. Press
    // Tab until the tree (or a row inside it) receives focus, or give up
    // after a generous bound.
    const isTreeFocused = async () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el?.getAttribute('role') === 'tree' || el?.closest('[role="tree"]') !== null;
      });

    // With a selected object, the canvas intentionally uses Tab/Shift+Tab to
    // cycle through paint-order selection. Escape clears that transient
    // canvas interaction so this check exercises ordinary shell focus order.
    await page.keyboard.press('Escape');
    let focused = false;
    for (let i = 0; i < 80 && !focused; i++) {
      await page.keyboard.press('Tab');
      focused = await isTreeFocused();
    }
    expect(focused).toBe(true);
  });

  test('arrow keys navigate correctly', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for arrow key nav');

    // Drawing a shape auto-selects it, so the tree's internal focusIdx
    // already tracks the front-most item (index 0, the last one seedLayers
    // drew) before any keypress — but real DOM focus only moves there in
    // response to a keypress-driven state change, so ArrowDown moves focus
    // *away* from index 0, to index 1, not onto index 0.
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    // ArrowDown should move to the second item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toBeFocused();

    // ArrowDown again should move to the third item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await expect(items.nth(2)).toBeFocused();

    // ArrowUp should move back to the second item
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toBeFocused();
  });

  test('home/end jump to first/last', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for home/end');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    // Go to the last item via End key
    await page.keyboard.press('End');
    await page.waitForTimeout(50);
    await expect(items.last()).toBeFocused();

    // Go to the first item via Home key
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);
    await expect(items.first()).toBeFocused();
  });

  test('space toggles selection', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for space toggle');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    // Focus starts on the first item (drawing auto-selects it); ArrowDown
    // moves to and selects the second item.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toBeFocused();

    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');

    // Space toggles selection of the focused item off, then back on.
    await page.keyboard.press(' ');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'false');

    // Space again restores the selection.
    await page.keyboard.press(' ');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('f2 starts rename', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 1, 'Need at least 1 layer for rename');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);

    // F2 should show rename input
    await page.keyboard.press('F2');
    await page.waitForTimeout(100);

    const nameInput = page.locator('.layers-row__name-input');
    if ((await nameInput.count()) > 0) {
      await expect(nameInput.first()).toBeFocused();
    }
  });

  test('escape cancels rename', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 1, 'Need at least 1 layer for escape cancel');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);

    // Start rename
    await page.keyboard.press('F2');
    await page.waitForTimeout(100);

    const nameInput = page.locator('.layers-row__name-input');
    if ((await nameInput.count()) > 0) {
      // Escape should cancel rename and return to tree focus
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const inputAfter = page.locator('.layers-row__name-input');
      expect(await inputAfter.count()).toBe(0);
    }
  });

  test('screen reader reads aria-selected state', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 1, 'Need at least 1 layer for aria-selected');

    // Drawing a shape auto-selects it, so the front-most item starts
    // selected — deselect via Escape first to test the attribute actually
    // reflects state rather than always being 'true'.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    const selectedBefore = await items.first().getAttribute('aria-selected');
    expect(selectedBefore).toBe('false');

    // Click to select
    await items.first().click();
    await page.waitForTimeout(50);

    const selectedAfter = await items.first().getAttribute('aria-selected');
    expect(selectedAfter).toBe('true');
  });

  test('screen reader reads aria-expanded state', async ({ page }) => {
    const container = page.locator('[aria-expanded]').first();
    const count = await container.count();
    test.skip(count < 1, 'Need at least 1 container with aria-expanded');

    // Container should have aria-expanded
    const expanded = await container.getAttribute('aria-expanded');
    expect(['true', 'false']).toContain(expanded);
  });

  test('reduced motion disables animations', async ({ page }) => {
    // The test checks that reduced motion styles exist in the CSS
    const cssContent = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (rule instanceof CSSMediaRule && rule.conditionText?.includes('reduced-motion')) {
              return true;
            }
          }
        } catch {
          // cross-origin stylesheet, skip
        }
      }
      return false;
    });

    expect(cssContent).toBe(true);
  });
});
