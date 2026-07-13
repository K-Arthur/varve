import { expect, test } from '@playwright/test';

/**
 * Native Tauri smoke — skipped unless STRATA_TAURI_E2E=1 and tauri-driver is running.
 *
 * Validates that the desktop webview loads the editor shell. Full interaction
 * coverage lives in tests/e2e/canvas/* (Chromium, shared DOM pipeline).
 */
test.describe('Tauri native smoke', () => {
  test.skip(
    !process.env.STRATA_TAURI_E2E,
    'Set STRATA_TAURI_E2E=1 with tauri-driver — see tests/e2e/tauri/README.md',
  );

  test('editor shell loads in native webview', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /^new$/i })).toBeVisible();
  });
});
