/**
 * Hybrid input handling.
 *
 * A touchscreen laptop, a desktop with a pen display, a convertible with a
 * mouse attached, a ChromeOS tablet with a trackpad and a tablet in a keyboard
 * case all expose a coarse *and* a fine pointer at the same time. These are
 * computers being operated with touch or a pen — not tablets — so touching them
 * must not hijack the session into the tablet layout. The tablet layout is the
 * automatic answer only when touch is the sole input, and it is always
 * available explicitly through the layout preference.
 *
 * Playwright's `hasTouch` emulates a coarse-only device, so this spec forces the
 * hybrid media-query answer a real convertible reports.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const HYBRID_QUERIES: Record<string, boolean> = {
  '(any-pointer: coarse)': true,
  '(any-pointer: fine)': true,
  '(pointer: coarse)': false,
  '(pointer: fine)': true,
  '(any-hover: hover)': true,
};

test.use({ hasTouch: true, viewport: { width: 1200, height: 800 } });

test('a hybrid device keeps its desktop layout when touch or pen is used', async ({ page }) => {
  await page.addInitScript((queries: Record<string, boolean>) => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const list = native(query);
      if (query in queries) {
        Object.defineProperty(list, 'matches', { get: () => queries[query], configurable: true });
      }
      return list;
    };
  }, HYBRID_QUERIES);

  await page.goto('/', { timeout: 45000, waitUntil: 'domcontentloaded' });
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-layout-mode', 'desktop', { timeout: 15000 });

  await navigateToEditor(page);
  await expect(root).toHaveAttribute('data-layout-mode', 'desktop');

  // A finger on the screen must not move the session into the tablet layout.
  await page.touchscreen.tap(420, 320);
  await expect(root).toHaveAttribute('data-layout-mode', 'desktop');

  // Narrowing the window still reflows to the compact desktop layout.
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(root).toHaveAttribute('data-layout-mode', 'compact');
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(root).toHaveAttribute('data-layout-mode', 'desktop');

  // The user can still choose the tablet layout explicitly.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('varve:layout-preference-request', { detail: { preference: 'tablet' } }),
    ),
  );
  await expect(root).toHaveAttribute('data-layout-mode', 'tablet');
  await expect(root).toHaveAttribute('data-layout-preference', 'tablet');

  // And returning to automatic restores the desktop layout.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('varve:layout-preference-request', { detail: { preference: 'auto' } }),
    ),
  );
  await expect(root).toHaveAttribute('data-layout-mode', 'desktop');
});
