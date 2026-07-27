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

test('Upscale dialog default state', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Default state shows balanced mode, 2x scale, new layer output
  await expect(page.getByLabel('Upscale mode')).toHaveValue('balanced');
  await expect(page.getByText('Output 32x16px')).toBeVisible();

  await expect(page).toHaveScreenshot('upscale-dialog-default.png', {
    maxDiffPixels: 100,
  });
});

test('Upscale dialog pixel-art mode', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  await page.getByLabel('Upscale mode').selectOption('pixel-art');
  await expect(page.getByText('Hard edges, no blur')).toBeVisible();
  await expect(page.getByLabel('Pixel-art algorithm')).toBeVisible();

  await expect(page).toHaveScreenshot('upscale-dialog-pixel-art.png', {
    maxDiffPixels: 100,
  });
});

test('Upscale dialog AI mode', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  await page.getByLabel('Upscale mode').selectOption('ai-enhance');
  await expect(page.getByText('Real-ESRGAN x4 super-resolution')).toBeVisible();

  await expect(page).toHaveScreenshot('upscale-dialog-ai-mode.png', {
    maxDiffPixels: 100,
  });
});

test('Upscale dialog denoise controls', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Denoise should be visible and default to None
  await expect(page.getByLabel('Denoise strength')).toBeVisible();
  await expect(
    page.getByLabel('Denoise strength').getByRole('button', { name: 'None' }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Switch to light denoise
  await page.getByLabel('Denoise strength').getByRole('button', { name: 'Light' }).click();

  await expect(page).toHaveScreenshot('upscale-dialog-denoise-light.png', {
    maxDiffPixels: 100,
  });
});

test('Upscale dialog scale options', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Balanced mode has 1.5x, 2x, 3x, 4x
  await expect(page.getByLabel('Scale factor').getByRole('button', { name: '3x' })).toBeVisible();
  await page.getByLabel('Scale factor').getByRole('button', { name: '3x' }).click();
  await expect(page.getByText('Output 48x16px')).toBeVisible();
});

test('Upscale dialog output behavior options', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  await expect(
    page.getByLabel('Output behavior').getByRole('button', { name: 'New layer' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByLabel('Output behavior').getByRole('button', { name: 'Replace source' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Output behavior').getByRole('button', { name: 'Non-destructive' }),
  ).toBeVisible();
});

test('Upscale dialog error state', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Cancel button works
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible();
});

test('Upscale dialog memory warning', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Switch to pixel-art mode with 8x scale
  await page.getByLabel('Upscale mode').selectOption('pixel-art');
  await page.getByLabel('Scale factor').getByRole('button', { name: '8x' }).click();

  // Should show output dimensions
  await expect(page.getByText('Output 128x64px')).toBeVisible();
});

test('Upscale dialog illustration mode', async ({ page }) => {
  await importTestImage(page);
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  await page.getByLabel('Upscale mode').selectOption('illustration');
  await expect(page.getByText('Real-ESRGAN anime-optimized')).toBeVisible();

  await expect(page).toHaveScreenshot('upscale-dialog-illustration-mode.png', {
    maxDiffPixels: 100,
  });
});
