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

test.describe('selection-to-flats workflow', () => {
  test.describe.configure({ timeout: 300000 });

  test('fills a selected pixel layer through Selection Sources and undoes it', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToHome(page);
    // Home boots with a synchronous memory facade and upgrades to IndexedDB
    // asynchronously. Wait for the real browser database before editing so
    // this test exercises the same durable target that reload/reopen uses.
    await page.waitForFunction(
      async () =>
        (await indexedDB.databases()).some(
          (database) => database.name === 'varve-home' && (database.version ?? 0) >= 6,
        ),
      undefined,
      { timeout: 60000 },
    );
    await page.waitForTimeout(500);

    // Create through the ordinary New dialog with print intent so the
    // raster target uses the existing bounded page path instead of the
    // unbounded-canvas 4096×4096 fallback. The page is resized through the
    // production Page Print controls below for a deterministic export fixture.
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

    // Keep the browser fixture small enough for deterministic PNG encoding on
    // low-memory/CPU-bound validation hosts. This uses the existing Page tool
    // and Page Print controls; it is not a test-only document mutation.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.keyboard.press('q');
    const pageCanvas = page.locator('canvas.editor-canvas__content-layer');
    const pageBox = await pageCanvas.boundingBox();
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
    await expect(
      page.locator('.workspace-dock__item[aria-label="Photo workspace"]'),
    ).toHaveAttribute('aria-checked', 'true');

    const toolbar = page.locator('[data-testid="toolbar"]');
    await toolbar.locator('[data-tool="paint"]').click();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor content canvas not found');

    await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.34, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[role="treeitem"][data-node-id]')).not.toHaveCount(0);

    const rasterRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'Brush Layer' })
      .first();
    await expect(rasterRow).toBeVisible();
    await rasterRow.click();
    await toolbar.locator('[data-tool="marquee"]').click();
    const toolOptions = page.getByRole('button', { name: 'Tool options' });
    await expect(toolOptions).toBeVisible();
    await toolOptions.click();

    const before = await canvas.screenshot();
    const surface = page.locator('.editor-canvas');
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error('editor canvas surface not found');
    await page.mouse.move(
      surfaceBox.x + surfaceBox.width * 0.3,
      surfaceBox.y + surfaceBox.height * 0.35,
    );
    await page.mouse.down();
    await page.mouse.move(
      surfaceBox.x + surfaceBox.width * 0.48,
      surfaceBox.y + surfaceBox.height * 0.5,
      { steps: 6 },
    );
    await page.mouse.up();

    await page.getByRole('button', { name: 'Selection Sources' }).click();
    const sources = page.getByTestId('selection-sources-panel');
    const fill = sources.getByRole('button', { name: 'Fill pixel layer' });
    await expect(fill).toBeEnabled();
    await fill.click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Selection filled on',
      { timeout: 10000 },
    );

    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
    expect(opaqueBlackPixels(after)).toBeGreaterThan(5000);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-after.png') });

    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => Buffer.compare(after, await canvas.screenshot()), { timeout: 10000 })
      .not.toBe(0);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-undo.png') });

    // Restore the filled state, save it through the ordinary Ctrl+S command,
    // export the actual raster, then reopen the saved document. The browser
    // fallback is used so this test does not wait on a native file picker.
    await page.keyboard.press('Control+Shift+z');
    const redone = await canvas.screenshot();
    expect(Buffer.compare(before, redone)).not.toBe(0);
    expect(opaqueBlackPixels(redone)).toBeGreaterThan(5000);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-redo.png') });
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
    // This home-created browser document uses Varve's library-backed save
    // target, so Save reports Saved without emitting a download. The reload
    // and reopen below are the durable persistence assertion for this path.

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.click();
    const pngGroup = page.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    await pngGroup.getByRole('button', { name: 'PNG', exact: true }).click();
    // Give the established export compositor time to render this real raster
    // under a shared CPU-bound validation host.
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const exportDownload = await exportDownloadPromise;
    await exportDownload.saveAs(testInfo.outputPath('selection-fill.png'));
    const { readFile } = await import('node:fs/promises');
    const exported = await readFile(testInfo.outputPath('selection-fill.png'));
    expect(exported.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const exportedPng = PNG.sync.read(exported);
    expect(exportedPng.width).toBe(640);
    expect(exportedPng.height).toBe(480);
    expect(opaqueBlackPixels(exported)).toBeGreaterThan(5000);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60000,
    });
    await expect(page.locator('[role="treeitem"][data-node-id]')).not.toHaveCount(0);
    await expect
      .poll(
        async () =>
          opaqueBlackPixels(await page.locator('canvas.editor-canvas__content-layer').screenshot()),
        { timeout: 15000 },
      )
      .toBeGreaterThan(5000);
    const reopened = await page.locator('canvas.editor-canvas__content-layer').screenshot();
    expect(opaqueBlackPixels(reopened)).toBeGreaterThan(5000);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-reopened.png') });
  });
});
