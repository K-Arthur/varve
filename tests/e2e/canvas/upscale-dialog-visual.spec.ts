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
  await expect(page.getByText(/Output:\s*32x32px/)).toBeVisible();
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
  const comparisonSources = await page.locator('.upscale-preview__image').evaluateAll((images) =>
    images.map((image) => {
      const element = image as HTMLImageElement;
      return { src: element.currentSrc, naturalWidth: element.naturalWidth };
    }),
  );
  expect(comparisonSources[0]?.src).not.toBe(comparisonSources[1]?.src);
  expect(comparisonSources[1]?.naturalWidth).toBeGreaterThan(
    comparisonSources[0]?.naturalWidth ?? 0,
  );
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
  await expect(page.locator('.upscale-preview__overlay')).toHaveAttribute(
    'style',
    /clip-path: inset\(0px 0px 0px 50%\)/,
  );
  const switcherWidths = await page.evaluate(() => {
    const settings = document.querySelector('.upscale-settings')?.getBoundingClientRect();
    const quality = document
      .querySelector('[aria-label="Quality policy"]')
      ?.getBoundingClientRect();
    return { settings: settings?.width ?? 0, quality: quality?.width ?? 0 };
  });
  expect(switcherWidths.quality).toBeLessThan(switcherWidths.settings);

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
  const pixelView = await previewContainer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const images = Array.from(element.querySelectorAll('img')) as HTMLImageElement[];
    return {
      surface: { width: rect.width, height: rect.height },
      natural: images.map(({ naturalWidth, naturalHeight }) => ({ naturalWidth, naturalHeight })),
    };
  });
  expect(pixelView.surface.width).toBe(pixelView.natural[1]?.naturalWidth);
  expect(pixelView.surface.height).toBe(pixelView.natural[1]?.naturalHeight);

  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(previewContainer).not.toHaveClass(/upscale-preview__image-container--zoom100/);
});

test('Enhance dialog reflows to a usable narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('button', { name: 'Enhance', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await openDialog(page);

  const dialog = page.getByRole('dialog', { name: 'Enhance image' });
  const body = dialog.locator('.upscale-dialog__body');
  const layout = await body.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { columns: style.gridTemplateColumns, width: rect.width };
  });

  expect(layout.columns.split(' ').length).toBe(1);
  expect(layout.width).toBeLessThanOrEqual(640);
  await expect(dialog.locator('.upscale-preview__image-container')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply recommended' })).toBeVisible();
});
