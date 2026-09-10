import { expect, test } from '@playwright/test';

/**
 * Native Tauri smoke — skipped unless VARVE_TAURI_E2E=1 and tauri-driver is running.
 *
 * Validates that the desktop webview loads the editor shell and that the
 * `withGlobalTauri: true` config exposes the Tauri IPC bridge. Full interaction
 * coverage lives in tests/e2e/canvas/* (Chromium, shared DOM pipeline).
 */

/** Check whether the current page is inside a Tauri webview. */
async function hasTauriInternals(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    return (
      typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined'
    );
  });
}

test.describe('Tauri native smoke', () => {
  test.skip(
    !process.env.VARVE_TAURI_E2E,
    'Set VARVE_TAURI_E2E=1 with tauri-driver — see tests/e2e/tauri/README.md',
  );

  test('editor shell loads in native webview', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /^new$/i })).toBeVisible();
  });

  test('window.__TAURI_INTERNALS__ is exposed (withGlobalTauri:true)', async ({ page }) => {
    test.skip(!process.env.VARVE_TAURI_E2E, 'Tauri-only test');
    await page.goto('/');
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
    expect(await hasTauriInternals(page)).toBe(true);
  });

  test('window.__TAURI__ is defined', async ({ page }) => {
    test.skip(!process.env.VARVE_TAURI_E2E, 'Tauri-only test');
    await page.goto('/');
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
    const hasTauri = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).__TAURI__ !== 'undefined';
    });
    expect(hasTauri).toBe(true);
  });

  test('Tauri IPC invoke is reachable', async ({ page }) => {
    test.skip(!process.env.VARVE_TAURI_E2E, 'Tauri-only test');
    await page.goto('/');
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
    const invokeReachable = await page.evaluate(() => {
      const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as
        | Record<string, unknown>
        | undefined;
      if (!internals) return false;
      return typeof internals.invoke === 'function';
    });
    expect(invokeReachable).toBe(true);
  });
});
