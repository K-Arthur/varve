import { expect, test } from '@playwright/test';

/**
 * Native updater surface — skipped unless VARVE_TAURI_E2E=1 with
 * tauri-driver running (see tests/e2e/tauri/README.md).
 *
 * Runs against the WDIO test build, which is a debug build: the native
 * runtime detector reports `development-build`, so the updater must be
 * honestly disabled — no consent dialog, no background checks, no check
 * button, and an explicit "unavailable for this build" status. The same
 * spec is the place to assert the packaged-build behaviors (consent dialog
 * on first run, check button enabled, install-on-quit toggle) once the
 * release AppImage/NSIS harness exists.
 */
async function openUpdatesSection(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });

  const settingsDialog = page.locator('dialog.varve-dialog--settings');
  await expect(settingsDialog).toHaveAttribute('open', '', { timeout: 10000 });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, div, span')].find(
      (e) => e.textContent?.trim() === 'Updates' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
}

test.describe('Updater surface (Tauri webview)', () => {
  test.skip(
    !process.env.VARVE_TAURI_E2E,
    'Set VARVE_TAURI_E2E=1 with tauri-driver — see tests/e2e/tauri/README.md',
  );

  test('development build: no consent dialog appears', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /^new$/i }).click();
    await page
      .locator('dialog')
      .getByRole('button', { name: /create/i })
      .click();
    await page.locator('.layers-panel').waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await expect(page.getByText('Keep Varve up to date?')).toHaveCount(0);
  });

  test('development build: Updates section reports unsupported and disables controls', async ({
    page,
  }) => {
    await openUpdatesSection(page);
    await expect(page.getByText('Updates are unavailable for this Varve build.')).toBeVisible();
    const checkButton = page.getByRole('button', { name: /check for updates/i });
    await expect(checkButton).toBeDisabled();
    const radios = page.getByRole('radio', { name: /manual|automatically check/i });
    await expect(radios.first()).toBeDisabled();
  });
});
