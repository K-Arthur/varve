import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Verifies the Enhance output semantics the export pipeline consumes:
 * the dialog reports the exact output dimensions, the derived layer is
 * created beside the source, and replace-source keeps a single layer.
 */
async function importImage(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

async function openEnhanceDialog(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Enhance', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Enhance image' })).toBeVisible();
  // Auto is the default; pick Upscale for the deterministic CPU path.
  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: 'Upscale', exact: true }).click();
}

test.describe
  .serial('enhance output semantics', () => {
    test('new-layer upscale reports exact doubled output dimensions', async ({ page }) => {
      test.setTimeout(120000);
      await importImage(page);
      await openEnhanceDialog(page);

      // The 100x100 fixture upscaled 2x must read exactly 200x200 in the
      // dialog's output info before applying.
      await expect(page.getByText('Output 200×200px', { exact: false })).toBeVisible();

      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Enhance image' })).not.toBeVisible({
        timeout: 30000,
      });
      // Two layers: original + derived.
      await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    });

    test('replace-source keeps a single layer', async ({ page }) => {
      test.setTimeout(120000);
      await importImage(page);
      await openEnhanceDialog(page);

      await page
        .getByRole('radiogroup', { name: 'Output behavior' })
        .getByText('Replace source', { exact: true })
        .click();
      await expect(page.getByText('Output 200×200px', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Enhance image' })).not.toBeVisible({
        timeout: 30000,
      });
      await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    });

    test('undo restores the original layer count after a new-layer upscale', async ({ page }) => {
      test.setTimeout(120000);
      await importImage(page);
      await openEnhanceDialog(page);
      await page.getByRole('button', { name: 'Upscale image' }).click();
      await expect(page.getByRole('dialog', { name: 'Enhance image' })).not.toBeVisible({
        timeout: 30000,
      });
      await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
      await page.keyboard.press('Control+z');
      await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    });
  });
