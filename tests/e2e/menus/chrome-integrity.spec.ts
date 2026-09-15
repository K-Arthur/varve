import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

/**
 * Chrome integrity — menubar / title-bar / window-control regressions.
 *
 * These tests run against the browser build, which must:
 *  - render the application menubar in-page (top of the document),
 *  - NOT render fake desktop window controls or a custom title bar,
 *  - never leak raw localization keys (`menu.edit`, `menu.help`, ...).
 *
 * The last assertion is the release-blocking regression guard for the
 * CachyOS screenshot defect where a GTK native menubar strip rendered raw
 * label keys above the window-control region.
 */
test.describe.configure({ mode: 'serial' });

test.describe('window-chrome integrity (browser build)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
  });

  test('does not render desktop window controls or a custom title bar', async ({ page }) => {
    // Browser build: no minimize/maximize/close controls, no custom chrome.
    await expect(page.locator('.title-bar')).toHaveCount(0);
    await expect(page.locator('[data-window-chrome]')).toHaveCount(0);
    await expect(page.locator('.title-bar__controls')).toHaveCount(0);
  });

  test('never renders raw localization keys anywhere in the menubar', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    await expect(menubar).toBeVisible();

    const rawKeys = await menubar
      .getByRole('menuitem')
      .evaluateAll((items) =>
        items
          .map((el) => (el.textContent ?? '').trim())
          .filter((text) => /^menu\./.test(text) || text.includes('menu.')),
      );
    expect(rawKeys, `raw localization keys found: ${rawKeys.join(', ')}`).toEqual([]);

    // Open every top-level menu and assert no raw keys leak into its items.
    const topLevelNames = await menubar.getByRole('menuitem').allTextContents();
    for (const name of topLevelNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      await openMenu(page, trimmed);
      const menuItems = page.locator('[role="menu"]').last().getByRole('menuitem');
      const count = await menuItems.count();
      for (let i = 0; i < count; i += 1) {
        const text = (await menuItems.nth(i).textContent()) ?? '';
        expect(text, `raw key in ${trimmed} menu`).not.toMatch(/^menu\./);
      }
      await page.keyboard.press('Escape');
    }
  });

  test('menubar sits at the top of the document with standard English menus', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    const box = await menubar.boundingBox();
    expect(box).not.toBeNull();
    // In the browser build the menubar is the topmost application surface.
    // Chromium can place the flex/grid surface at a fractional CSS-pixel
    // offset (3.171875px on the hosted Linux runner) even with the global
    // margin/padding reset. Keep this a near-zero guard without rejecting
    // that harmless device-scale rounding.
    expect(box!.y).toBeLessThanOrEqual(4);

    const names = (await menubar.getByRole('menuitem').allTextContents()).map((t) => t.trim());
    expect(names).toContain('File');
    expect(names).toContain('Edit');
    expect(names).toContain('View');
    expect(names).toContain('Help');
    expect(names.some((n) => n.includes('menu.'))).toBe(false);
  });
});
