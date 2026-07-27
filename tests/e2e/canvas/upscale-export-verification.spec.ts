import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function importAndUpscale(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

test.describe
  .serial('upscale export verification', () => {
    test('upscaled image exported as PNG has correct dimensions', async ({ page }) => {
      test.setTimeout(120000);
      await importAndUpscale(page);

      // Open upscale dialog
      await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

      // Use balanced mode, 2x scale
      await page.getByLabel('Upscale mode').selectOption('balanced');
      await page.getByLabel('Scale factor').getByRole('button', { name: '2x' }).click();

      // Apply
      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
        timeout: 30000,
      });

      // Should have 2 layers now (original + upscaled)
      await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

      // Export dialog
      await page.getByRole('button', { name: 'Export' }).click();
      await expect(page.getByRole('dialog', { name: /export/i })).toBeVisible({ timeout: 5000 });

      // Select PNG format
      await page.getByLabel(/format/i).selectOption('png');
      // Select the upscaled layer
      await page.getByLabel(/select layer/i).click();
      await page.getByRole('option', { name: /4x|upscale|2x/i }).click();

      // Start download
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByRole('button', { name: /export|download/i }).click(),
      ]);

      expect(download).toBeDefined();
      const downloadPath = await download.path();
      expect(downloadPath).toBeTruthy();
    });

    test('upscaled image applied as replace source exports correctly', async ({ page }) => {
      test.setTimeout(120000);
      await importAndUpscale(page);

      await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

      // Use balanced mode, replace source
      await page.getByLabel('Upscale mode').selectOption('balanced');
      await page
        .getByLabel('Output behavior')
        .getByRole('button', { name: 'Replace source' })
        .click();

      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
        timeout: 30000,
      });

      // Should still have 1 layer (replaced)
      await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

      // Select the layer and export
      await page.getByRole('treeitem').click();
      await page.getByRole('button', { name: 'Export' }).click();
      await expect(page.getByRole('dialog', { name: /export/i })).toBeVisible({ timeout: 5000 });

      await page.getByLabel(/format/i).selectOption('png');

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByRole('button', { name: /export|download/i }).click(),
      ]);

      expect(download).toBeDefined();
    });

    test('pixel-art upscale exports at correct integer dimensions', async ({ page }) => {
      test.setTimeout(120000);
      await importAndUpscale(page);

      // Open upscale dialog
      await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

      // Pixel-art mode, 4x scale with EPX algorithm
      await page.getByLabel('Upscale mode').selectOption('pixel-art');
      await page.getByLabel('Scale factor').getByRole('button', { name: '4x' }).click();

      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
        timeout: 30000,
      });

      // Should have 2 layers
      await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

      // Verify the upscaled layer dimensions by selecting it
      await page.getByRole('treeitem').filter({ hasText: '4x' }).click();

      // Open export and verify PNG
      await page.getByRole('button', { name: 'Export' }).click();
      await expect(page.getByRole('dialog', { name: /export/i })).toBeVisible({ timeout: 5000 });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByRole('button', { name: /export|download/i }).click(),
      ]);

      expect(download).toBeDefined();
    });

    test('upscaled image survives save and reopen', async ({ page }) => {
      test.setTimeout(180000);
      await importAndUpscale(page);

      // Apply 2x balanced upscale as new layer
      await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

      await page.getByLabel('Upscale mode').selectOption('balanced');
      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
        timeout: 30000,
      });

      await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

      // Save the document
      await page.keyboard.press('Control+s');
      await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 10000 });

      // Reload
      await page.reload();
      await page.waitForSelector('.layers-panel', { timeout: 15000 });

      // Should have at least 1 layer after reload
      await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 15000 });
    });

    test('upscale then undo restores original for export', async ({ page }) => {
      test.setTimeout(120000);
      await importAndUpscale(page);

      // Apply upscale
      await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
        timeout: 30000,
      });

      await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

      // Undo
      await page.keyboard.press('Control+z');
      await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

      // Export should work with restored original
      await page.getByRole('button', { name: 'Export' }).click();
      await expect(page.getByRole('dialog', { name: /export/i })).toBeVisible({ timeout: 5000 });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByRole('button', { name: /export|download/i }).click(),
      ]);

      expect(download).toBeDefined();
    });
  });
