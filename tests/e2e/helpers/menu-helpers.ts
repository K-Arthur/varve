import { type Page, expect } from '@playwright/test';

const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

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
  const menubar = page.locator('[role="menubar"]');
  const item = menubar.locator('[role="menuitem"]', { hasText: name });
  await item.click();
  await expect(page.locator('[role="menu"]').first()).toBeVisible();
  return item;
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
    (window as unknown as Record<string, number>).__STRATA_TYPEAHEAD_MS = val;
  }, ms);
}

export async function resetTypeAheadTimeout(page: Page) {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, number>).__STRATA_TYPEAHEAD_MS;
  });
}

export async function getFocusedMenuItem(page: Page) {
  return page.locator(
    '[role="menu"] [role="menuitem"]:focus, [role="menu"] [role="menuitemradio"]:focus, [role="menu"] [role="menuitemcheckbox"]:focus',
  );
}
