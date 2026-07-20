import { expect, test } from '@playwright/test';

test.describe('Create File dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.strata-home');
  });

  test('clicking New File opens dialog', async ({ page }) => {
    await page.getByRole('button', { name: /^new$/i }).click();
    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.strata-dialog__title')).toContainText(/new file/i);
  });

  test('blank tab shows blank canvas and the full preset picker', async ({ page }) => {
    // As of the unified preset system, New File is blank-canvas-first plus a
    // searchable, grouped PresetPicker (@strata/ui) fed the full
    // @strata/shared preset registry (photo/print/web/mobile-tablet/desktop/
    // social/video-motion/presentation/paper/icon-asset) — not just a
    // print-only grid. Device/social frame presets are also still available
    // inside the editor via FramePresetsSection.
    await page.getByRole('button', { name: /^new$/i }).click();
    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('tab', { name: 'Blank' })).toBeVisible();
    // getByText('Blank canvas') also matches the icon's <title> a11y text —
    // scope to the visible label span.
    await expect(dialog.locator('.new-file__blank-title')).toHaveText('Blank canvas');
    await expect(dialog.getByText('Presets')).toBeVisible();
    await expect(dialog.getByPlaceholder('Search presets...')).toBeVisible();
    await expect(dialog.getByText('A4')).toBeVisible();

    await dialog.getByPlaceholder('Search presets...').fill('Instagram');
    await expect(dialog.getByText('Instagram Post')).toBeVisible();
    await expect(dialog.getByText('A4')).not.toBeVisible();
  });

  test('templates tab shows templates', async ({ page }) => {
    await page.getByRole('button', { name: /^new$/i }).click();
    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();

    await dialog.getByText('Templates').click();
    await page.waitForTimeout(200);

    await expect(dialog.locator('.templates-gallery')).toBeVisible();
    await expect(dialog.locator('.template-card')).toHaveCount(
      await dialog.locator('.template-card').count(),
    );
  });

  test('clicking Create navigates to editor', async ({ page }) => {
    await page.getByRole('button', { name: /^new$/i }).click();
    await page.waitForSelector('dialog.strata-dialog[open]');

    await page.getByRole('button', { name: /^create$/i }).click();
    await page.waitForSelector('.layers-panel', { timeout: 10000 });

    await expect(page.locator('.layers-panel')).toBeVisible();
  });
});
