import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe.configure({ mode: 'serial' });

async function importTestImage(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

async function openDialog(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Enhance', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Enhance image' })).toBeVisible();
}

test('Enhance dialog default (Auto) state', async ({ page }) => {
  await importTestImage(page);
  await openDialog(page);

  // Auto is the default; the analysis recommends upscale for the 16x16 icon.
  await expect(page.getByText(/Low source resolution/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Output 16by16px')).toBeVisible();

  await expect(page).toHaveScreenshot('enhance-dialog-default.png', {
    maxDiffPixels: 200,
  });
});

test('Enhance dialog pixel-art mode', async ({ page }) => {
  await importTestImage(page);
  await openDialog(page);

  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: 'Upscale', exact: true }).click();
  await page.getByRole('combobox', { name: 'Upscale quality' }).click();
  await page.getByRole('option', { name: 'Pixel art', exact: true }).click();
  await expect(page.getByText(/Hard edges, no blur/i)).toBeVisible();
  await expect(page.getByLabel('Pixel-art algorithm')).toBeVisible();

  await expect(page).toHaveScreenshot('enhance-dialog-pixel-art.png', {
    maxDiffPixels: 200,
  });
});
