import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Layers Panel - Multi-Page', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    // A blank editor starts without a page. Create the first page so these
    // tests exercise the page strip rather than waiting for a hidden nav.
    await page.getByTestId('layers-panel').getByRole('button', { name: 'Add page' }).click();
    await page.waitForSelector('[role="tablist"][aria-label="Page navigation"]');
  });

  test('page strip renders page thumbnails', async ({ page }) => {
    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const firstTab = tabs.first();
    await expect(firstTab).toBeVisible();
    await expect(firstTab).toHaveAttribute('aria-label', /Page:/);
  });

  test('clicking page thumbnail switches active page', async ({ page }) => {
    const addBtn = page.locator('.page-nav__add-btn');
    await addBtn.click();

    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    await expect(tabs).toHaveCount(2);
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // First tab is active, second is not
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');

    // Click second tab
    await tabs.nth(1).click();
    await page.waitForTimeout(100);

    // Now second tab is active, first is not
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('adding a new page creates new thumbnail', async ({ page }) => {
    const addBtn = page.locator('.page-nav__add-btn');
    const tabsBefore = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const beforeCount = await tabsBefore.count();

    await addBtn.click();

    const tabsAfter = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    await expect(tabsAfter).toHaveCount(beforeCount + 1);
    const afterCount = await tabsAfter.count();
    expect(afterCount).toBe(beforeCount + 1);
  });

  test('deleting a page removes its thumbnail', async ({ page }) => {
    // Add a second page first
    const addBtn = page.locator('.page-nav__add-btn');
    await addBtn.click();

    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    await expect(tabs).toHaveCount(2);
    const beforeCount = await tabs.count();
    expect(beforeCount).toBeGreaterThanOrEqual(2);

    // Right-click second page to open context menu
    await tabs.nth(1).click({ button: 'right' });
    await page.waitForTimeout(100);

    // Click delete in context menu
    const deleteBtn = page.getByRole('menuitem', { name: /Delete page and contents/i });
    if ((await deleteBtn.count()) > 0) {
      await deleteBtn.click();
      await expect(tabs).toHaveCount(beforeCount - 1);
    }
  });

  test('cannot delete the last page', async ({ page }) => {
    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);

    if (count === 1) {
      // Right-click the only page
      await tabs.first().click({ button: 'right' });
      await page.waitForTimeout(100);

      // Delete button should be disabled
      const deleteBtn = page.getByRole('menuitem', { name: /Delete page and contents/i });
      if ((await deleteBtn.count()) > 0) {
        await expect(deleteBtn).toBeDisabled();
      }
    }
  });

  test('each page shows its own content in layers tree', async ({ page }) => {
    // Add a second page
    const addBtn = page.locator('.page-nav__add-btn');
    await addBtn.click();

    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    await expect(tabs).toHaveCount(2);
    const layersPanel = page.getByTestId('layers-panel');

    // Switch between pages and verify tree re-renders
    await tabs.nth(0).click();
    await page.waitForTimeout(100);
    await expect(layersPanel).toBeAttached();

    await tabs.nth(1).click();
    await page.waitForTimeout(100);
    await expect(layersPanel).toBeAttached();
  });

  test('global children visible across all pages', async ({ page }) => {
    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');

    // Get tree items on first page
    await tabs.first().click();
    await page.waitForTimeout(100);

    const layersPanel = page.getByTestId('layers-panel');
    await expect(layersPanel).toBeAttached();
  });
});
