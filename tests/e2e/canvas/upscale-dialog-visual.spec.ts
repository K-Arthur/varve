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
  await expect(page.getByText(/Output:\s*32×32px/)).toBeVisible();
  await expect(
    page.getByAltText('Enhanced preview — same crop and output size as original'),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.upscale-preview__image--upscaled')).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator('.upscale-preview__image--upscaled').evaluate((image) => {
        return (image as HTMLImageElement).naturalWidth;
      }),
    )
    .toBeGreaterThan(0);
  const previewBoxes = await page.locator('.upscale-preview__image').evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  expect(previewBoxes).toHaveLength(2);
  expect(previewBoxes.every(({ width, height }) => width > 100 && height > 100)).toBe(true);
  expect(Math.abs(previewBoxes[0]!.width - previewBoxes[1]!.width)).toBeLessThan(1);
  expect(Math.abs(previewBoxes[0]!.height - previewBoxes[1]!.height)).toBeLessThan(1);

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
  await expect(
    page.getByAltText('Enhanced preview — same crop and output size as original'),
  ).toBeVisible({ timeout: 15000 });

  await expect(page).toHaveScreenshot('enhance-dialog-pixel-art.png', {
    maxDiffPixels: 200,
  });
});

test('preview crop and zoom controls update the comparison view', async ({ page }) => {
  await importTestImage(page);
  await openDialog(page);

  const focusPicker = page.getByRole('group', {
    name: 'Preview region (pick the area to inspect)',
  });
  const topLeft = focusPicker.getByRole('button', { name: 'Preview top left' });
  await topLeft.click();
  await expect(topLeft).toHaveAttribute('aria-pressed', 'true');

  const previewContainer = page.locator('.upscale-preview__image-container');
  const zoom100 = page.getByRole('button', { name: '100%' });
  await zoom100.click();
  await expect(previewContainer).toHaveClass(/upscale-preview__image-container--zoom100/);

  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(previewContainer).not.toHaveClass(/upscale-preview__image-container--zoom100/);
});
