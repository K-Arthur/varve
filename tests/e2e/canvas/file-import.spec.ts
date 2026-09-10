/**
 * E2E: File → Import must open the asset/artwork picker (accepting svg/png/
 * jpg/...), NOT the document-open picker. The regression this guards is the
 * reported bug where Import silently opened the .varve/.strata/.json document
 * picker, making images and SVGs impossible to import from the menu.
 *
 * The test clicks the real menu action and feeds files to the hidden
 * `#file-import-input`, then asserts the artwork actually lands in the scene.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// Minimal 1x1 RGBA PNG (valid signature + IHDR + IDAT + IEND with CRCs).
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5fNwAAAAABJRU5ErkJggg==';

const SIMPLE_SVG =
  '<svg><rect x="10" y="10" width="100" height="60" fill="#1f8a70" /><circle cx="60" cy="40" r="24" fill="#ffd166" /></svg>';

async function openImportFromMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
}

async function ensureEditor(page: import('@playwright/test').Page): Promise<void> {
  const layers = page.locator('.layers-panel');
  if (await layers.isVisible({ timeout: 1000 }).catch(() => false)) return;

  const recentFile = page.getByRole('gridcell').first();
  await recentFile.waitFor({ state: 'visible', timeout: 10000 });
  await recentFile.click();
  await layers.waitFor({ state: 'visible', timeout: 30000 });
}

test.describe('File → Import', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await ensureEditor(page);
  });

  test('Import picker accepts PNG and SVG artwork and renders it in the document', async ({
    page,
  }) => {
    await openImportFromMenu(page);
    await expect(page.locator('#file-import-input')).toBeAttached();
    // The import picker must advertise raster + vector, never only documents.
    const accept = await page.locator('#file-import-input').getAttribute('accept');
    expect(accept).toContain('.png');
    expect(accept).toContain('.svg');
    expect(accept).not.toContain('.varve');

    await page.locator('#file-import-input').setInputFiles([
      {
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(PNG_1X1_BASE64, 'base64'),
      },
      {
        name: 'logo.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(SIMPLE_SVG, 'utf-8'),
      },
    ]);

    const layers = page.locator('.layers-panel');
    await expect(layers.getByText('photo.png')).toBeVisible({ timeout: 30000 });
    // The PNG is one node; the SVG contributes its root and two vector
    // children to the layer tree.
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(3, {
      timeout: 30000,
    });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    await expect(canvas).toHaveScreenshot('file-import-svg.png', {
      // Canvas worker startup can leave the SVG paint one frame behind while
      // the imported scene and selection are already authoritative.
      maxDiffPixels: 7000,
    });
  });

  test('Import picker accepts JPEG artwork and renders the raster image', async ({ page }) => {
    await openImportFromMenu(page);
    const jpeg = await readFile('tests/fixtures/bg-removal-corpus/object.jpg');
    await page.locator('#file-import-input').setInputFiles({
      name: 'object.jpg',
      mimeType: 'image/jpeg',
      buffer: jpeg,
    });

    const layers = page.locator('.layers-panel');
    await expect(layers.getByText('object.jpg')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-jpeg.png',
      { maxDiffPixels: 7000 },
    );
  });

  test('Import picker imports the remaining raster formats', async ({ page }) => {
    await openImportFromMenu(page);
    const files = await Promise.all(
      ['raster.webp', 'raster.gif', 'raster.bmp', 'raster.tif', 'raster.avif'].map(
        async (name) => ({
          name,
          mimeType: `image/${name.split('.').pop()}`,
          buffer: await readFile(`tests/fixtures/import-corpus/${name}`),
        }),
      ),
    );
    await page.locator('#file-import-input').setInputFiles(files);

    const layers = page.locator('.layers-panel');
    for (const file of files) {
      await expect(layers.getByText(file.name)).toBeVisible({ timeout: 30000 });
    }
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-raster-matrix.png',
      { maxDiffPixels: 12000 },
    );
  });

  test('Import picker advertises parser-backed formats', async ({ page }) => {
    await openImportFromMenu(page);
    const accept = await page.locator('#file-import-input').getAttribute('accept');
    for (const extension of [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.bmp',
      '.tif',
      '.tiff',
      '.avif',
      '.psd',
      '.psb',
      '.svg',
      '.pdf',
      '.ai',
      '.eps',
      '.fig',
      '.sketch',
    ]) {
      expect(accept).toContain(extension);
    }
  });

  test('PSD and PSB import real layered documents', async ({ page }) => {
    await openImportFromMenu(page);
    const files = await Promise.all(
      ['example.psd', 'example.psb'].map(async (name) => ({
        name,
        mimeType: 'image/vnd.adobe.photoshop',
        buffer: await readFile(`tests/fixtures/import-corpus/${name}`),
      })),
    );
    await page.locator('#file-import-input').setInputFiles(files);

    const layers = page.locator('.layers-panel');
    await expect(layers.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('dialog', { name: 'Import results' })).toContainText(/imported/i);
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-psd.png',
      { maxDiffPixels: 12000 },
    );
  });

  test('PDF, AI, and EPS parser imports produce scene content', async ({ page }) => {
    await openImportFromMenu(page);
    const pdf = `%PDF-1.4
BT /F1 12 Tf 100 700 Td (Imported PDF) Tj ET
100 100 200 100 re f
`;
    const eps = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 300 200
20 30 120 80 rectfill
showpage
`;
    await page.locator('#file-import-input').setInputFiles([
      { name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) },
      { name: 'sample.ai', mimeType: 'application/postscript', buffer: Buffer.from(pdf) },
      { name: 'sample.eps', mimeType: 'application/postscript', buffer: Buffer.from(eps) },
    ]);

    const layers = page.locator('.layers-panel');
    await expect(layers.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('dialog', { name: 'Import results' })).toContainText(/imported/i);
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-vector-parsers.png',
      { maxDiffPixels: 12000 },
    );
  });
});
