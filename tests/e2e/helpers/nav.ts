import type { Page } from '@playwright/test';

/** Navigate to a clean editor, deterministically dismissing the crash
 *  recovery dialog that a previously killed run can leave behind. */
export async function navigateToCleanEditor(page: Page): Promise<void> {
  await page.goto('/', { timeout: 120000, waitUntil: 'domcontentloaded' });
  // Safe mode (localStorage-backed, left by crashed runs) blocks the whole
  // app: clear its flag and reload.
  const inSafeMode = await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null);
  if (inSafeMode) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 120000 });
  }
  // Safe mode dialog with "Continue normal startup" button
  const safeModeDialog = page.getByRole('button', { name: /continue normal startup/i });
  if (await safeModeDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    await safeModeDialog.click({ timeout: 5000 });
    await page.waitForTimeout(1000);
  }
  // Crash recovery dialog (IndexedDB-backed): "Review my documents" only
  // dismisses the dialog, so clicking it is side-effect free.
  const recovery = page.locator('dialog[open]').filter({
    hasText: /closed unexpectedly|recover your documents/i,
  });
  if ((await recovery.count()) > 0) {
    await recovery
      .getByRole('button', { name: /review my documents/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await page.waitForTimeout(400);
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 150000 });
  await newBtn.click({ force: true, timeout: 15000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click({ timeout: 30000 });
  await page.locator('.layers-panel').waitFor({ timeout: 150000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => undefined);
    }
  }

  // Keep visual and interaction fixtures free of the in-editor onboarding
  // checklist. It is not a dialog, so the startup dialog loop above cannot
  // dismiss it and it otherwise obscures the Layers panel screenshots.
  const onboardingDismiss = page.locator('.onboarding-checklist__dismiss');
  if (await onboardingDismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
    await onboardingDismiss.click({ timeout: 5000 });
  }
}
