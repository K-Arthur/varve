import path from 'node:path';
import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

/**
 * Captures the real Enhance dialog for the marketing website. The Auto
 * analysis is pure client-side (no model download), so the screenshot is
 * deterministic and offline.
 */
test('captures the enhance dialog in Auto mode for the website', async ({ page }) => {
  test.setTimeout(420000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/fixtures/restore-corpus/text-heavy--gauss-sigma35.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.getByRole('button', { name: 'Enhance', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enhance image' });
  await expect(dialog).toBeVisible();

  // Wait for the deterministic analysis result.
  await expect(dialog.getByText(/Recommended:/)).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByText(/noise/i).first()).toBeVisible();

  await dialog.screenshot({
    path: 'apps/website/public/screenshots/enhance-dialog-auto.png',
  });
});
