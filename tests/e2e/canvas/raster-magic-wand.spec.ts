import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToHome, switchWorkspace } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

function opaqueBlackPixels(input: Buffer): number {
  const image = PNG.sync.read(input);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0;
    if (
      alpha > 200 &&
      (image.data[offset] ?? 255) < 16 &&
      (image.data[offset + 1] ?? 255) < 16 &&
      (image.data[offset + 2] ?? 255) < 16
    ) {
      count += 1;
    }
  }
  return count;
}

const VIEWPORT = { width: 1280, height: 800 };

test.describe('raster Magic Wand workflow', () => {
  test.describe.configure({ timeout: 180000 });

  test('selects a raster region and sends it through the existing flat-fill action', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToHome(page);
    await page.waitForFunction(
      async () =>
        (await indexedDB.databases()).some(
          (database) => database.name === 'varve-home' && (database.version ?? 0) >= 6,
        ),
      undefined,
      { timeout: 60000 },
    );
    await page.waitForTimeout(500);

    await page.getByTestId('new-file-button').click({ force: true });
    const newDialog = page.locator('dialog.varve-dialog[open]');
    await expect(newDialog).toBeVisible({ timeout: 10000 });
    await newDialog.getByRole('button', { name: /advanced settings/i }).click();
    await newDialog
      .getByRole('radiogroup', { name: 'Document intent' })
      .locator('label')
      .filter({ hasText: /^Print$/ })
      .click();
    await newDialog.getByTestId('create-design-button').click();
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60000,
    });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.keyboard.press('q');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const pageBox = await canvas.boundingBox();
    if (!pageBox) throw new Error('page canvas not found');
    await page.mouse.click(pageBox.x + pageBox.width / 2, pageBox.y + pageBox.height / 2);
    await page.getByText('Page Print').first().waitFor({ timeout: 10000 });
    const printSection = page.locator('.page-print');
    await printSection.getByLabel(/page width/i).fill('640');
    await printSection.getByLabel(/page height/i).fill('480');
    await printSection.getByLabel(/page height/i).press('Enter');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await switchWorkspace(page, 'Photo');
    const toolbar = page.locator('[data-testid="toolbar"]');
    await toolbar.locator('[data-tool="paint"]').click();
    const paintBox = await canvas.boundingBox();
    if (!paintBox) throw new Error('content canvas not found');
    const start = { x: paintBox.x + paintBox.width * 0.26, y: paintBox.y + paintBox.height * 0.34 };
    const end = { x: paintBox.x + paintBox.width * 0.45, y: paintBox.y + paintBox.height * 0.44 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    // Paint batches are confirmed by the existing worker after pointer-up;
    // wait for that authoritative tile before sampling it with Magic Wand.
    await page.waitForTimeout(1500);

    // Locate the real painted mark in the content canvas rather than relying
    // on page/world offsets. This keeps the pointer proof valid when the
    // editor's fit-page camera or panel widths change.
    const painted = PNG.sync.read(await canvas.screenshot());
    let minX = painted.width;
    let minY = painted.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < painted.height; y += 1) {
      for (let x = 0; x < painted.width; x += 1) {
        const offset = (y * painted.width + x) * 4;
        if (
          (painted.data[offset] ?? 255) < 24 &&
          (painted.data[offset + 1] ?? 255) < 24 &&
          (painted.data[offset + 2] ?? 255) < 24 &&
          (painted.data[offset + 3] ?? 0) > 200
        ) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX || maxY < minY) throw new Error('painted raster mark was not rendered');

    const rasterRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'Brush Layer' })
      .first();
    await expect(rasterRow).toBeVisible();
    await rasterRow.click();

    // Use the established Magic Wand shortcut on the same raster layer. The
    // default foreground is intentionally sufficient here: this assertion is
    // about raster sampling and the existing fill route, not colour-picker
    // chrome that is workspace-specific.
    await page.keyboard.press('Shift+W');
    await expect(page.getByTestId('magicwand-options')).toBeVisible({ timeout: 10000 });
    const clickPoint = {
      x: paintBox.x + ((minX + maxX) / 2) * (paintBox.width / painted.width),
      y: paintBox.y + ((minY + maxY) / 2) * (paintBox.height / painted.height),
    };
    await page.mouse.click(clickPoint.x, clickPoint.y);

    const announcer = page.locator('#strata-canvas-announcer-polite');
    await expect(announcer).toContainText(/pixel-layer Magic Wand selection created/i, {
      timeout: 15000,
    });
    await page.screenshot({ path: testInfo.outputPath('raster-magic-wand-selection.png') });

    await page.getByRole('button', { name: 'Selection Sources' }).click();
    const sources = page.getByTestId('selection-sources-panel');
    const fill = sources.getByRole('button', { name: 'Fill pixel layer' });
    await expect(fill).toBeEnabled();
    await fill.click();
    await expect(announcer).toContainText('Selection filled on', { timeout: 15000 });
    await page.screenshot({ path: testInfo.outputPath('raster-magic-wand-filled.png') });

    // Prove that the raster-selection route survives the same durable save,
    // export, and Home-library reopen path as the marquee workflow.
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    await page.waitForTimeout(750);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.waitForTimeout(750);

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.click();
    const pngGroup = page.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    await pngGroup.getByRole('radio', { name: 'PNG', exact: true }).click();
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const exportDownload = await exportDownloadPromise;
    const exportPath = testInfo.outputPath('raster-magic-wand.png');
    await exportDownload.saveAs(exportPath);
    const { readFile } = await import('node:fs/promises');
    const exported = await readFile(exportPath);
    expect(exported.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const exportedPng = PNG.sync.read(exported);
    expect(exportedPng.width).toBe(640);
    expect(exportedPng.height).toBe(480);
    expect(opaqueBlackPixels(exported)).toBeGreaterThan(1000);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60000,
    });
    await expect(page.locator('[role="treeitem"][data-node-id]')).not.toHaveCount(0);
    const reopenedCanvas = page.locator('canvas.editor-canvas__content-layer');
    await expect
      .poll(async () => opaqueBlackPixels(await reopenedCanvas.screenshot()), { timeout: 15000 })
      .toBeGreaterThan(1000);
    await page.screenshot({ path: testInfo.outputPath('raster-magic-wand-reopened.png') });
  });
});
