import path from 'node:path';
import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

test('imports an image and upscales it through the dialog', async ({ page }) => {
  test.setTimeout(180000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Open Upscale Dialog' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trace monochrome' })).toBeVisible();

  // Open the upscale dialog via the inspector.
  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Select AI enhancement mode.
  await page.getByLabel('Upscale mode').selectOption('ai-enhance');
  await expect(page.getByText('Real-ESRGAN x4 super-resolution')).toBeVisible();

  // Apply the upscale.
  await page.getByRole('button', { name: 'Upscale with AI' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
  await expect(page.getByRole('treeitem').filter({ hasText: '4x-ai' })).toHaveCount(1);

  // Undo.
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});

test('opens the upscale dialog via keyboard shortcut', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  // Use the keyboard shortcut to open the dialog.
  await page.keyboard.press('Control+Shift+U');
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Close via Escape.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible();
});

test('cancels the upscale dialog without applying', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Cancel.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});

test('changes scale factor in the upscale dialog', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Select balanced mode (bicubic) and change scale.
  await page.getByLabel('Upscale mode').selectOption('balanced');
  await page.getByLabel('Scale factor').getByRole('button', { name: '3x' }).click();
  await expect(page.getByText('Output 48x16px')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('switches output behavior in the upscale dialog', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: 'Open Upscale Dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Switch to "Replace source" output.
  await page.getByLabel('Output behavior').getByRole('button', { name: 'Replace source' }).click();

  // Apply — should replace the source, not create a new layer.
  await page.getByRole('button', { name: 'Upscale image' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});
