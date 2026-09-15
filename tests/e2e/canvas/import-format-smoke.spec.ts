/**
 * Functional format smoke coverage through the real File > Import action.
 *
 * The long-lived visual baselines in file-import.spec.ts intentionally belong
 * to the canvas shell and can move when an unrelated toolbar changes height.
 * These checks keep format conversion coverage independent: they assert the
 * Import Results rows and the layer tree, then save a reviewable screenshot for
 * manual visual inspection without changing those shared baselines.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function openImportFromMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
}

async function expandReport(
  page: import('@playwright/test').Page,
  names: readonly string[],
): Promise<void> {
  const report = page.getByRole('dialog', { name: 'Import results' });
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report).toContainText(/imported|failed|unsupported/i);
  await report.getByRole('button', { name: /show details/i }).click();
  for (const name of names) {
    await expect(report).toContainText(name);
  }
}

test.describe('File > Import format smoke', () => {
  test.describe.configure({ mode: 'serial' });

  test('imports real PSD/PSB and TIFF bytes through the menu', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await openImportFromMenu(page);

    const files = await Promise.all(
      ['example.psd', 'example.psb', 'raster.tif'].map(async (name) => ({
        name,
        mimeType: name.endsWith('.tif') ? 'image/tiff' : 'image/vnd.adobe.photoshop',
        buffer: await readFile(`tests/fixtures/import-corpus/${name}`),
      })),
    );
    await page.locator('#file-import-input').setInputFiles(files);

    await expect(page.locator('.layers-panel [role="treeitem"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await expandReport(
      page,
      files.map((file) => file.name),
    );
    await page.screenshot({ path: testInfo.outputPath('design-format-psd-tiff.png') });
    await page
      .getByRole('dialog', { name: 'Import results' })
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click();
    await page.screenshot({ path: testInfo.outputPath('design-format-psd-tiff-artwork.png') });
  });

  test('imports SVG, PDF, AI, and EPS content through the menu', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await openImportFromMenu(page);

    const svg =
      '<svg width="180" height="120" viewBox="10 20 90 60">' +
      '<rect x="10" y="20" width="18" height="12" fill="#1f8a70"/>' +
      '<g transform="translate(20 10) scale(1.5)">' +
      '<circle cx="30" cy="30" r="9" fill="#ffd166"/>' +
      '</g>' +
      '<rect x="80" y="60" width="12" height="10" fill="#ef476f"/>' +
      '</svg>';
    const pdf = '%PDF-1.4\nBT /F1 12 Tf 100 700 Td (Imported PDF) Tj ET\n100 100 200 100 re f\n';
    const eps =
      '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 300 200\n20 30 120 80 rectfill\nshowpage\n';
    const files = [
      { name: 'ordered.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) },
      { name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) },
      { name: 'sample.ai', mimeType: 'application/postscript', buffer: Buffer.from(pdf) },
      { name: 'sample.eps', mimeType: 'application/postscript', buffer: Buffer.from(eps) },
    ];
    await page.locator('#file-import-input').setInputFiles(files);

    await expect(page.locator('.layers-panel [role="treeitem"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await expandReport(
      page,
      files.map((file) => file.name),
    );
    await page.screenshot({ path: testInfo.outputPath('design-format-svg-ai-eps.png') });
    await page
      .getByRole('dialog', { name: 'Import results' })
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click();
    await page.screenshot({ path: testInfo.outputPath('design-format-svg-ai-eps-artwork.png') });
  });
});
