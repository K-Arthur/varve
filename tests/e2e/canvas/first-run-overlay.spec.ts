/**
 * First-run overlay coverage.
 *
 * Automation skips the overlay on a fresh profile so the rest of the suite
 * can reach the editor. This spec opts back in with the force key and
 * exercises the real overlay: three steps, dismiss, local persistence.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const FORCE_KEY = 'varve:first-run-overlay:force';
const DISMISSED_KEY = 'varve:first-run-overlay:dismissed';

test.describe('first-run overlay', () => {
  test('stays off a fresh Playwright profile so the editor is clickable', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.locator('.first-run-overlay')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^rectangle$/i })).toBeVisible();
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await expect(page.getByRole('button', { name: /^rectangle$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('walks three steps, dismisses, and stays dismissed', async ({ page }) => {
    await page.addInitScript((key: string) => {
      localStorage.setItem(key, '1');
    }, FORCE_KEY);

    await navigateToEditor(page);

    const overlay = page.locator('.first-run-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.first-run-backdrop')).toBeVisible();
    await expect(overlay.getByRole('heading', { name: 'Welcome to Varve' })).toBeVisible();

    await overlay.getByRole('button', { name: 'Next' }).click();
    await expect(overlay.getByRole('heading', { name: 'Tools at Your Fingertips' })).toBeVisible();

    await overlay.getByRole('button', { name: 'Next' }).click();
    await expect(overlay.getByRole('heading', { name: 'Get Help Anytime' })).toBeVisible();
    await expect(overlay.getByRole('link', { name: 'Open Start Here Guide' })).toBeVisible();

    await overlay.getByRole('button', { name: 'Get Started' }).click();
    await expect(overlay).toHaveCount(0);
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DISMISSED_KEY))
      .toBe('true');

    // Reloading an in-editor session returns to Home (unclean-startup
    // recovery). Re-open the same file: the overlay must stay gone even
    // though the force key is still set.
    await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
    const recovery = page.locator('dialog[open]').filter({
      hasText: /closed unexpectedly|recover your documents/i,
    });
    if ((await recovery.count()) > 0) {
      await recovery
        .getByRole('button', { name: /review my documents/i })
        .first()
        .click({ timeout: 5000 })
        .catch(() => undefined);
    }
    const recent = page.getByRole('gridcell').first();
    await recent.waitFor({ state: 'visible', timeout: 60000 });
    await recent.dblclick({ timeout: 15000 });
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60000 });
    await expect(page.locator('.first-run-overlay')).toHaveCount(0);
  });

  test('close button dismisses and remembers the choice', async ({ page }) => {
    await page.addInitScript((key: string) => {
      localStorage.setItem(key, '1');
    }, FORCE_KEY);

    await navigateToEditor(page);

    const overlay = page.locator('.first-run-overlay');
    await expect(overlay).toBeVisible();
    await overlay.getByRole('button', { name: 'Close' }).click();
    await expect(overlay).toHaveCount(0);
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DISMISSED_KEY))
      .toBe('true');
  });
});
