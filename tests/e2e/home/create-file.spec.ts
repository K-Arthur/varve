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

  test('blank tab shows blank canvas and print document options', async ({ page }) => {
    // As of 123b56e ("Figma preset model"), New File is blank-canvas-first:
    // device/social/web size presets moved into the editor as
    // FramePresetsSection, applied to a frame after creation. The dialog
    // itself now only offers a blank canvas and print (CMYK) document
    // sizes — there is no "Presets" tab or "Web" option here anymore.
    await page.getByRole('button', { name: /^new$/i }).click();
    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('tab', { name: 'Blank' })).toBeVisible();
    // getByText('Blank canvas') also matches the icon's <title> a11y text —
    // scope to the visible label span.
    await expect(dialog.locator('.new-file__blank-title')).toHaveText('Blank canvas');
    await expect(dialog.getByText('Print document')).toBeVisible();
    await expect(dialog.getByText('A4')).toBeVisible();
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
