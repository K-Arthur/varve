import { expect, test } from '@playwright/test';

test('capture crash UX screenshots', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 45000 });
  await page.evaluate(async () => {
    const h = (
      window as unknown as { __varveCrashTest?: { simulateWorkerCrash: () => Promise<void> } }
    ).__varveCrashTest;
    if (h) await h.simulateWorkerCrash('webgl context lost in render worker');
  });
  const dialog = page.getByRole('dialog', { name: 'Varve closed unexpectedly' });
  await dialog.waitFor({ timeout: 15000 });
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.waitForTimeout(300);
  await dialog.screenshot({ path: 'docs/crash-reporting/screenshots/crash-recovery-dialog.png' });
  await page.getByRole('button', { name: 'Review report' }).click();
  const review = page.getByRole('dialog', { name: 'Review crash report' });
  await review.waitFor({ timeout: 5000 });
  await review.screenshot({ path: 'docs/crash-reporting/screenshots/review-before-send.png' });
  await page.getByRole('button', { name: 'Back' }).click();
  // Dev builds have no ingestion endpoint; inject a stub transport so the
  // success receipt is reachable for the screenshot.
  await page.evaluate(() => {
    const h = (
      window as unknown as {
        __varveCrashTest?: {
          setUploaderForTesting: (u: {
            upload: () => Promise<{ ok: boolean; retryable: boolean; status: number }>;
          }) => void;
        };
      }
    ).__varveCrashTest;
    h?.setUploaderForTesting({
      upload: async () => ({ ok: true, retryable: false, status: 200 }),
    });
  });
  await page.getByRole('button', { name: 'Send report' }).click();
  await page.getByText(/Report sent/).waitFor({ timeout: 8000 });
  await dialog.screenshot({ path: 'docs/crash-reporting/screenshots/report-receipt.png' });
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem(
      'varve:crash-loop',
      JSON.stringify({ failures: [now - 2000, now - 1000, now] }),
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const safe = page.getByRole('alertdialog', { name: 'Varve had trouble starting' });
  await safe.waitFor({ timeout: 15000 });
  await safe.screenshot({ path: 'docs/crash-reporting/screenshots/safe-mode.png' });
  await safe.getByRole('button', { name: 'Continue normal startup' }).click();
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 15000 });
  // Privacy settings live in the editor; open a document first.
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .waitFor({ timeout: 8000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('varve:open-privacy-settings'));
  });
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.waitFor({ timeout: 8000 });
  await page.getByRole('tab', { name: 'Privacy & Diagnostics' }).click();
  await page.waitForTimeout(300);
  await settings.screenshot({ path: 'docs/crash-reporting/screenshots/privacy-settings.png' });
  expect(true).toBe(true);
});
