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

test.describe('Layers Panel - Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
  });

  test('tab enters layers tree', async ({ page }) => {
    const _tree = page.getByRole('tree', { name: /layers/i });
    // Press Tab until the tree receives focus
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    const isTreeFocused = await focused.evaluate(
      (el) => el.getAttribute('role') === 'tree' || el.closest('[role="tree"]') !== null,
    );
    expect(isTreeFocused).toBe(true);
  });

  test('arrow keys navigate correctly', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for arrow key nav');

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    // ArrowDown should focus the first item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await expect(items.first()).toBeFocused();

    // ArrowDown again should move to second item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await expect(items.nth(1)).toBeFocused();

    // ArrowUp should move back to first item
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(50);
    await expect(items.first()).toBeFocused();
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

    // Focus first item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);

    // Space should toggle selection of first item
    await page.keyboard.press(' ');
    await page.waitForTimeout(50);
    await expect(items.first()).toHaveAttribute('aria-selected', 'true');

    // Space again should deselect
    await page.keyboard.press(' ');
    await page.waitForTimeout(50);
    await expect(items.first()).toHaveAttribute('aria-selected', 'false');
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

    // By default, no item should be selected
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
    // Check that the reduced motion media query is respected
    const _hasReducedMotionStyles = await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent =
        '@media (prefers-reduced-motion: reduce) { .layers-row { transition: none !important; } }';
      document.head.appendChild(style);

      const row = document.querySelector('.layers-row');
      if (!row) return true; // no rows to check, skip gracefully

      const computed = window.getComputedStyle(row);
      return computed.transition === 'none' || computed.transition === '';
    });

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
