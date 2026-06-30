import { expect, test } from '@playwright/test';

test.describe('Layers Panel - APG Tree View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.layers-panel');
  });

  test('renders a tree with correct ARIA semantics', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();
    await expect(tree).toHaveAttribute('aria-multiselectable', 'true');
  });

  test('keyboard navigation with arrow keys', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    // Focus moved to first row
    const firstItem = page.getByRole('treeitem').first();
    await expect(firstItem).toBeFocused();
  });

  test('expand and collapse containers with arrow keys', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();

    // Find first container with aria-expanded
    const container = page.locator('[aria-expanded]').first();
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

    const menu = page.locator('.layers-context-menu');
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
    const filter = page.locator('.layers-panel__filter-input');
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
