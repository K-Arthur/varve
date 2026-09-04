import { expect, test } from '@playwright/test';

test.describe('Home context menu', () => {
  test.beforeEach(async ({ page }) => {
    // Use the deterministic Home fixture so the context-menu assertions always
    // exercise a real file card instead of passing through an empty-state
    // early return in a fresh browser profile.
    await page.goto('/e2e.html');
    await page.waitForSelector('.varve-home');
  });

  test('right-click opens context menu on file card', async ({ page }) => {
    const grid = page.locator('.home-grid[role="grid"]');
    const card = grid.locator('[role="gridcell"]').first();
    const count = await grid.locator('[role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();
  });

  test('right-click context menu shows Open, Rename, Duplicate items', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(ctxMenu.locator('[role="menuitem"]').filter({ hasText: 'Open' })).toBeVisible();
    await expect(ctxMenu.locator('[role="menuitem"]').filter({ hasText: 'Rename' })).toBeVisible();
    await expect(
      ctxMenu.locator('[role="menuitem"]').filter({ hasText: 'Duplicate' }),
    ).toBeVisible();
  });

  test('keeps longer file actions readable', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });

    const ctxMenu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();
    await expect(ctxMenu).toHaveClass(/varve-menu--default/);

    const labels = await ctxMenu.locator('.varve-menu__item-label').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          text: element.textContent,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          textOverflow: style.textOverflow,
        };
      }),
    );
    const labelTexts = labels.map((label) => label.text);

    for (const text of [
      'Move earlier in order',
      'Move later in order',
      'Version History...',
      'Show in Folder',
      'Move to Trash',
    ]) {
      expect(labelTexts).toContain(text);
    }
    expect(labelTexts.some((text) => ['Hide from Recent', 'Show in Recent'].includes(text))).toBe(
      true,
    );
    expect(
      labelTexts.some((text) => ['Add to Favorites', 'Remove from Favorites'].includes(text)),
    ).toBe(true);
    for (const label of labels) {
      expect(label.textOverflow).not.toBe('ellipsis');
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
    }

    await page.screenshot({
      path:
        process.env.VARVE_MENU_REVIEW_PATH ??
        'test-results/visual/home-file-context-menu-readable.png',
      animations: 'disabled',
    });
  });

  test('Escape closes context menu', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(ctxMenu).not.toBeVisible();
  });

  test('left-click closes context menu', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();

    await page.locator('.varve-home__toolbar').click();
    await page.waitForTimeout(200);
    await expect(ctxMenu).not.toBeVisible();
  });
});
