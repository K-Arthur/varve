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
      'Version History…',
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

    const geometry = await ctxMenu.evaluate((menu) => {
      const layer = menu.parentElement;
      const menuRect = menu.getBoundingClientRect();
      const layerRect = layer?.getBoundingClientRect();
      const layerStyle = layer ? getComputedStyle(layer) : null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menu: {
          left: menuRect.left,
          top: menuRect.top,
          right: menuRect.right,
          bottom: menuRect.bottom,
        },
        layer: layerRect
          ? {
              left: layerRect.left,
              top: layerRect.top,
              right: layerRect.right,
              bottom: layerRect.bottom,
              clientHeight: layer?.clientHeight ?? 0,
              scrollHeight: layer?.scrollHeight ?? 0,
            }
          : null,
        overflowY: layerStyle?.overflowY ?? null,
      };
    });

    expect(geometry.layer).not.toBeNull();
    expect(geometry.layer!.left).toBeGreaterThanOrEqual(0);
    expect(geometry.layer!.top).toBeGreaterThanOrEqual(0);
    expect(geometry.layer!.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.layer!.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.layer!.clientHeight).toBeGreaterThan(0);
    expect(geometry.layer!.scrollHeight).toBeGreaterThanOrEqual(geometry.layer!.clientHeight);
    expect(geometry.overflowY).toBe('auto');

    await page.screenshot({
      path:
        process.env.VARVE_MENU_REVIEW_PATH ??
        'test-results/visual/home-file-context-menu-readable.png',
      animations: 'disabled',
    });
  });

  test('keeps a lower-right invocation inside the viewport', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').last();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    await card.click({
      button: 'right',
      position: { x: cardBox!.width - 8, y: cardBox!.height - 8 },
    });

    const ctxMenu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(ctxMenu).toBeVisible();
    const geometry = await ctxMenu.evaluate((menu) => {
      const layer = menu.parentElement;
      const layerRect = layer?.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menu: {
          left: menuRect.left,
          top: menuRect.top,
          right: menuRect.right,
          bottom: menuRect.bottom,
        },
        layer: layerRect
          ? {
              left: layerRect.left,
              top: layerRect.top,
              right: layerRect.right,
              bottom: layerRect.bottom,
              clientHeight: layer?.clientHeight ?? 0,
              scrollHeight: layer?.scrollHeight ?? 0,
            }
          : null,
        overflowY: layer ? getComputedStyle(layer).overflowY : null,
      };
    });

    expect(geometry.layer).not.toBeNull();
    expect(geometry.layer!.left).toBeGreaterThanOrEqual(0);
    expect(geometry.layer!.top).toBeGreaterThanOrEqual(0);
    expect(geometry.layer!.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.layer!.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.menu.left).toBeGreaterThanOrEqual(0);
    expect(geometry.menu.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.overflowY).toBe('auto');
    await page.screenshot({
      path:
        process.env.VARVE_MENU_EDGE_REVIEW_PATH ??
        'test-results/visual/home-file-context-menu-edge-readable.png',
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
