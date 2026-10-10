import { expect, test } from '@playwright/test';

/**
 * Recovered diagnostics must not open the crash-recovery dialog or the
 * ErrorBoundary fallback. Genuine unhandled rejections still must.
 */
test.describe('benign crash diagnostics', () => {
  test('ResizeObserver, abort, and context-lost stay off the crash screen', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home').waitFor({ timeout: 45000 });

    await page.evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'ResizeObserver loop completed with undelivered notifications.',
        }),
      );
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }),
      );
      window.dispatchEvent(new Event('webglcontextlost'));
      const reason = new DOMException('The operation was aborted.', 'AbortError');
      const promise = Promise.reject(reason);
      void promise.catch(() => undefined);
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise, reason }));
    });

    await page.waitForTimeout(400);
    await expect(page.getByRole('dialog', { name: 'Varve closed unexpectedly' })).toHaveCount(0);
    await expect(page.locator('.error-boundary')).toHaveCount(0);
    await expect(page.locator('.varve-home')).toBeVisible();
  });

  test('a genuine unhandled rejection still opens the crash dialog', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home').waitFor({ timeout: 45000 });

    const hooked = await page.evaluate(() => {
      const hooks = (
        window as unknown as {
          __varveCrashTest?: { rejectPromise: (message?: string) => void };
        }
      ).__varveCrashTest;
      if (!hooks) return false;
      hooks.rejectPromise('genuine crash for benign-filter regression');
      return true;
    });
    expect(hooked).toBe(true);

    await expect(page.getByRole('dialog', { name: 'Varve closed unexpectedly' })).toBeVisible({
      timeout: 15000,
    });
  });
});
