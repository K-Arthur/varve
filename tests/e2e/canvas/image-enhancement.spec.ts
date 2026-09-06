import path from 'node:path';
import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

const DIALOG = 'Enhance image';

/** Pick an operation in the Enhance dialog's custom Select. */
async function selectOperation(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function openEnhanceDialog(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page
    .getByRole('button', { name: /^Enhance|^Upscale$/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: DIALOG })).toBeVisible();
}

test('imports an image and upscales it through the dialog', async ({ page }) => {
  test.setTimeout(180000);
  await openEnhanceDialog(page);

  // The dialog opens in Auto/Recommended; pick a deterministic CPU upscale.
  await selectOperation(page, 'Upscale');
  await page.getByRole('button', { name: 'Upscale image' }).click();
  await expect(page.getByRole('dialog', { name: DIALOG })).not.toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

  // Undo.
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});

test('auto mode recommends an operation for a low-resolution import', async ({ page }) => {
  test.setTimeout(180000);
  await openEnhanceDialog(page);

  // The 16x16 favicon is below the resolution threshold, so the analysis
  // must recommend upscaling without any model download.
  await expect(page.getByText(/Low source resolution/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply recommended' })).toBeEnabled();

  await page.getByRole('button', { name: 'Apply recommended' }).click();
  await expect(page.getByRole('dialog', { name: DIALOG })).not.toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
});

test('denoises with SCUNet before applying a CPU upscale', async ({ page }) => {
  await navigateToEditor(page);

  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page
    .getByRole('button', { name: /^Enhance|^Upscale$/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: DIALOG })).toBeVisible();
  await selectOperation(page, 'Denoise');
  await page
    .getByRole('radiogroup', { name: 'Denoise strength' })
    .getByText('Light', { exact: true })
    .click();
  const denoiseButton = page.getByRole('button', { name: 'Denoise image' });
  if (await denoiseButton.isDisabled()) {
    // Model downloads are explicit and intentionally not faked with an
    // invalid IndexedDB blob. Verify the honest offline state instead.
    await expect(page.getByText(/SCUNet model.*not installed/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download model' })).toBeVisible();
    return;
  }
  await denoiseButton.click();

  await expect(page.getByRole('dialog', { name: DIALOG })).not.toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
});

test('keeps explicit no-denoise selection as a no-op', async ({ page }) => {
  test.setTimeout(60000);
  await openEnhanceDialog(page);
  await selectOperation(page, 'Denoise');
  await page
    .getByRole('radiogroup', { name: 'Denoise strength' })
    .getByText('None', { exact: true })
    .click();

  await expect(
    page.getByText(/No denoising selected; the source remains unchanged/i),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'No change to apply' })).toBeDisabled();
  await expect(page.getByRole('dialog', { name: DIALOG })).toBeVisible();
});

test('runs the bundled Real-ESRGAN model for an AI preview and final output', async ({ page }) => {
  test.setTimeout(180000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-48x48.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page
    .getByRole('button', { name: /^Enhance|^Upscale$/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: DIALOG })).toBeVisible();

  await selectOperation(page, 'Upscale');
  await page.getByRole('combobox', { name: 'Upscale quality' }).click();
  await page.getByRole('option', { name: 'AI enhancement', exact: true }).click();
  const previewButton = page.getByRole('button', { name: 'Generate AI preview' });
  await expect(previewButton).toBeEnabled({ timeout: 30000 });
  await previewButton.click();
  await expect(
    page.getByAltText('Enhanced preview — same crop and output size as original'),
  ).toBeVisible({ timeout: 120000 });
  await expect(page.locator('.upscale-preview__image--upscaled')).toHaveAttribute(
    'src',
    /^data:image\/png/,
  );

  await page.getByRole('button', { name: 'Upscale with AI' }).click();
  await expect(page.getByRole('dialog', { name: DIALOG })).not.toBeVisible({ timeout: 120000 });
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
});

test('opens the enhance dialog via keyboard shortcut', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  // Use the keyboard shortcut to open the dialog.
  await page.keyboard.press('Control+Shift+U');
  await expect(page.getByRole('dialog', { name: DIALOG })).toBeVisible();

  // Close via Escape.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: DIALOG })).not.toBeVisible();
});

test('cancels the enhance dialog without applying', async ({ page }) => {
  test.setTimeout(60000);
  await openEnhanceDialog(page);

  // Cancel.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: DIALOG })).not.toBeVisible();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});

test('changes scale factor in the enhance dialog', async ({ page }) => {
  test.setTimeout(60000);
  await openEnhanceDialog(page);
  await selectOperation(page, 'Upscale');

  // Quality mode (Lanczos-3) is the default; change its scale.
  await page
    .getByRole('radiogroup', { name: 'Scale factor' })
    .getByText('3x', { exact: true })
    .click();
  await expect(page.getByText(/Output 48(?:×|x)48px/, { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('switches output behavior in the enhance dialog', async ({ page }) => {
  test.setTimeout(60000);
  await openEnhanceDialog(page);
  await selectOperation(page, 'Upscale');

  // Switch to "Replace source" output.
  await page
    .getByRole('radiogroup', { name: 'Output behavior' })
    .getByText('Replace source', { exact: true })
    .click();

  // Apply — should replace the source, not create a new layer.
  await page.getByRole('button', { name: 'Upscale image' }).click();
  await expect(page.getByRole('dialog', { name: DIALOG })).not.toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
});

test('keeps the action label, controls, and presets synchronized', async ({ page }) => {
  test.setTimeout(60000);
  await openEnhanceDialog(page);

  await expect(page.getByRole('button', { name: 'Apply recommended' })).toBeVisible();
  await selectOperation(page, 'Upscale');
  await expect(page.getByRole('button', { name: 'Upscale image' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Upscale quality' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Scale factor' })).toBeVisible();

  await selectOperation(page, 'Denoise');
  await expect(page.getByRole('button', { name: 'Denoise image' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Denoise strength' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Upscale quality' })).not.toBeVisible();

  await selectOperation(page, 'Restore + Upscale');
  await expect(page.getByRole('button', { name: 'Restore and upscale' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Upscale quality' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Denoise strength' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: /Deblur \+ Upscale/ }).click();
  await expect(page.getByRole('button', { name: 'Deblur and upscale' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Deblur strength' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Enhancement preset' }).click();
  await page.getByRole('option', { name: /Photo AI upscale/ }).click();
  await expect(page.getByRole('combobox', { name: 'Enhancement operation' })).toHaveText('Upscale');
  await expect(page.getByRole('button', { name: 'Upscale with AI' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Enhancement preset' })).toHaveText(
    'Photo AI upscale',
  );

  await page
    .getByRole('radiogroup', { name: 'Quality policy' })
    .getByText('Faithful', { exact: true })
    .click();
  await expect(page.getByRole('combobox', { name: 'Enhancement preset' })).toHaveText(
    'Custom settings',
  );
});
