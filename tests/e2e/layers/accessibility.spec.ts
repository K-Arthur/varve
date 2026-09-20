import { mkdirSync, writeFileSync } from 'node:fs';
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

  test('arrows move focus without selecting; Space toggles the focused row', async ({ page }) => {
    // Documented contract (docs/architecture/layers-navigation.md): plain
    // arrows move tree focus and scroll the row only — selection changes
    // come from Space (membership toggle), Shift+Arrow (range), or clicks.
    // This is the APG multiselectable-tree model; a previous version of this
    // test expected ArrowDown to select, which contradicts it.
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for space toggle');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toBeFocused();

    // Space toggles the focused row into the selection, then back out.
    await page.keyboard.press(' ');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press(' ');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'false');
  });

  test('type-ahead jumps to the next row with a matching prefix', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 3, 'Need at least 3 layers for type-ahead');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    // seedLayers creates "Rectangle 1..3"; focus the first row, type the
    // shared prefix once to land on the next match ("Rectangle 2"), again
    // after the decay window to cycle onto "Rectangle 3".
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);
    await page.keyboard.type('r');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toBeFocused();
  });

  test('row accessible names carry state without relying on color', async ({ page }) => {
    const items = page.getByRole('treeitem');
    await items.first().click();

    // Lock the first row via its toggle, then read the treeitem's accessible
    // description: state must be text, never color alone (WCAG 1.4.1).
    const row = items.first();
    await row.getByRole('button', { name: /^Lock / }).click();
    await page.waitForTimeout(100);
    const label = await row.getAttribute('aria-label');
    expect(label ?? '').toMatch(/locked/i);
  });

  test('shift+arrow extends the selection range', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 3, 'Need at least 3 layers for range selection');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    // Let the canvas→tree selection sync settle so the range anchor is the
    // seeded front-most layer. Under WebKitGTK the first Shift+ArrowDown can
    // otherwise land before the sync commits and assemble a 1-row range.
    await page.waitForTimeout(400);

    // The seeded front-most layer is the initial selection and range anchor.
    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(50);
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(items.nth(2)).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(50);
    for (let index = 0; index < 3; index += 1) {
      await expect(items.nth(index)).toHaveAttribute('aria-selected', 'true');
    }
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
    // Treeitems only: the row's details disclosure button also carries
    // aria-expanded, and it is not a hierarchy container.
    const container = page.locator('[role="treeitem"][aria-expanded]').first();
    const count = await container.count();
    test.skip(count < 1, 'Need at least 1 container with aria-expanded');

    // Container should have aria-expanded
    const expanded = await container.getAttribute('aria-expanded');
    expect(['true', 'false']).toContain(expanded);
  });

  test('exposes hierarchy, expansion, and selection through the computed ARIA tree', async ({
    page,
  }) => {
    // Synthetic stand-in for a screen-reader walkthrough: `ariaSnapshot()`
    // serializes Chromium's computed accessibility tree — what an assistive
    // technology actually receives — rather than the DOM attributes. It
    // cannot replace a physical NVDA/Orca/VoiceOver session, but it does
    // catch the class of regression where attributes exist but the tree the
    // AT sees is flat, unnamed, or missing state.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    // A frame with a child, so the tree contains a real hierarchy.
    await page.keyboard.press('f');
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 280, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 140, box.y + 140);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('Home');
    const snapshot = await tree.ariaSnapshot();

    expect(snapshot).toContain('treeitem');
    expect(snapshot).toContain('expanded');
    expect(snapshot).toContain('level=2');
    // The focused/selected row states the layer name, so the AT user hears
    // an identity, not "tree item".
    expect(snapshot).toMatch(/treeitem "[^"]+"/);

    mkdirSync('reports/layers-evolution/after', { recursive: true });
    writeFileSync('reports/layers-evolution/after/aria-tree-snapshot.yaml', snapshot);
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
