import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

async function resetOnboardingPersistence(page: import('@playwright/test').Page): Promise<void> {
  // A stopped browser worker is recorded as an unclean startup. Clear the
  // crash-loop state before the app boot sequence can turn it into safe mode.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__varve_e2e_reset') === '1') return;
    for (const key of Object.keys(localStorage)) {
      if (/safe|crash|recovery|error|consecutive/i.test(key)) localStorage.removeItem(key);
    }
    sessionStorage.setItem('__varve_e2e_reset', '1');
  });
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.removeItem('strata:onboarding');
    const request = indexedDB.open('varve-home');
    await new Promise<void>((resolve) => {
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete('app-setting_onboarding');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
    });
  });
  await page.goto('/');
}

test.describe('onboarding and help', () => {
  test('welcome dialog offers skip paths and tour can be dismissed', async ({ page }) => {
    await resetOnboardingPersistence(page);
    await navigateToEditor(page);

    // Welcome is deliberately opt-in. Exercise the supported Help-menu entry
    // instead of relying on an obsolete first-launch auto-popup contract.
    await page.getByRole('menuitem', { name: /^help$/i }).click();
    await page.getByRole('menuitem', { name: /^getting started$/i }).click();

    const welcome = page.getByRole('dialog', { name: /welcome to varve/i });
    await expect(welcome).toBeVisible();

    await page.getByRole('button', { name: /blank canvas/i }).click();
    await expect(welcome).toBeHidden({ timeout: 5000 });

    // Dismissed state is persisted without forcing a reload, which would
    // intentionally count as an unclean startup in the crash-loop fixture.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('strata:onboarding');
          return raw ? JSON.parse(raw).onboardingComplete : false;
        }),
      )
      .toBe(true);
  });

  test('F1 opens contextual help without blocking the canvas', async ({ page }) => {
    await navigateToEditor(page);

    // navigateToEditor dismisses the first-run modal for ordinary workflows.
    // The help surface itself must therefore be reachable without relying on
    // a welcome-dialog button that may no longer exist.
    await page.keyboard.press('F1');
    await expect(page.getByRole('complementary', { name: 'Help' })).toBeVisible();
    await expect(page.locator('.editor-canvas')).toBeVisible();
  });

  test('help center opens from Help menu', async ({ page }) => {
    await navigateToEditor(page);

    const welcomeClose = page.getByRole('button', { name: /blank canvas/i });
    if (await welcomeClose.isVisible({ timeout: 1000 }).catch(() => false)) {
      await welcomeClose.click();
    }

    await page.getByRole('menuitem', { name: /^help$/i }).click();
    await page.getByRole('menuitem', { name: /help center/i }).click();
    await expect(page.getByRole('dialog').filter({ hasText: /help/i })).toBeVisible();
  });
});
