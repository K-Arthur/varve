import path from 'node:path';
import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

test('imports, upscales, undoes, and traces an image through the inspector', async ({ page }) => {
  test.setTimeout(180000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Upscale image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trace monochrome' })).toBeVisible();
  await expect(page.getByText(/Processing runs locally.*Real-ESRGAN/i)).toBeVisible();

  await page.getByLabel('Upscale factor').selectOption('2');
  await page.getByRole('button', { name: 'Upscale image' }).click();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
  await expect(page.getByRole('treeitem').filter({ hasText: '2x' })).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

  await page.getByLabel('Upscale method').selectOption('ai');
  await expect(page.getByLabel('Upscale factor')).toHaveValue('4');
  await expect(page.getByLabel('Upscale factor')).toBeDisabled();
  await page.getByRole('button', { name: 'Upscale image' }).click();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 120000 });
  await expect(page.getByRole('treeitem').filter({ hasText: '4x-ai' })).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

  await page.getByLabel('Background removal method').selectOption('ai-balanced');
  await page.getByRole('button', { name: 'Remove background from image' }).click();
  const bgReview = page.getByRole('region', { name: 'Background removal review' });
  await expect(bgReview).toBeVisible({ timeout: 120000 });
  await bgReview.getByRole('button', { name: 'Apply result' }).click();
  await expect(page.getByText('Method: ai-balanced')).toBeVisible({ timeout: 120000 });

  await page.getByRole('button', { name: 'Trace monochrome' }).click();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toContainText('trace');
});
