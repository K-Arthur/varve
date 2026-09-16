import { expect, type Page } from '@playwright/test';

export function mod(key: string): string {
  return process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`;
}

export function isMac(): boolean {
  return process.platform === 'darwin';
}

export function platformModLabel(): string {
  return isMac() ? 'Cmd' : 'Ctrl';
}

export async function focusMenubar(page: Page) {
  const menubar = page.locator('[role="menubar"]');
  const firstItem = menubar.locator('[role="menuitem"]').first();
  await firstItem.focus();
  return firstItem;
}

export async function openMenu(page: Page, name: string) {
  // A menu left open by an earlier step turns the trigger click into a
  // toggle-close. Normalize first (Escape closes the submenu, then the
  // parent menu, so allow more than one press).
  for (let attempt = 0; attempt < 3 && (await page.getByRole('menu').count()) > 0; attempt += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
  const menubar = page.locator('[role="menubar"]');
  const item = menubar.locator('[role="menuitem"]', { hasText: name });
  await item.click();
  await expect(page.locator('[role="menu"]').first()).toBeVisible();
  return item;
}

/**
 * Open a top-level menu and hover one of its submenu entries.
 *
 * The View menu groups its bulk into submenus (the flat list measured taller
 * than a 1280x800 viewport). Submenus open on pointer hover, matching the
 * component's own mouse-intent handling.
 */
export async function openSubmenu(page: Page, menuName: string, submenuLabel: string) {
  await openMenu(page, menuName);
  const parent = page.locator(`[role="menu"][aria-label="${menuName}"]`);
  await parent.locator('[role="menuitem"]', { hasText: submenuLabel }).hover();
  const submenu = page.locator(`[role="menu"][aria-label="${submenuLabel}"]`);
  await expect(submenu).toBeVisible();
  return submenu;
}

export async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="menu"]')).toHaveCount(0, { timeout: 2000 });
}

export async function assertFocusNotOnBody(page: Page) {
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? 'null');
  expect(activeTag).not.toBe('BODY');
}

export async function assertActiveElementRole(page: Page, role: string) {
  const activeRole = await page.evaluate(
    () => document.activeElement?.getAttribute('role') ?? 'null',
  );
  expect(activeRole).toBe(role);
}

export async function setTypeAheadTimeout(page: Page, ms: number) {
  await page.evaluate((val) => {
    (window as unknown as Record<string, number>).__VARVE_TYPEAHEAD_MS = val;
  }, ms);
}

export async function resetTypeAheadTimeout(page: Page) {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, number>).__VARVE_TYPEAHEAD_MS;
  });
}

export async function getFocusedMenuItem(page: Page) {
  return page.locator(
    '[role="menu"] [role="menuitem"]:focus, [role="menu"] [role="menuitemradio"]:focus, [role="menu"] [role="menuitemcheckbox"]:focus',
  );
}
