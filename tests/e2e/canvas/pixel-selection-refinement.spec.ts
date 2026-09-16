/**
 * Real-browser coverage for destructive selection refinement and its separate
 * area-selection undo history. The test uses the existing editor, raster
 * layer, Selection Sources, save, reopen, and export surfaces; it does not
 * introduce a drawing-specific document or workspace.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToHome, switchWorkspace } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

const VIEWPORT = { width: 1280, height: 800 };

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

async function openPixelSelectionCommand(
  page: import('@playwright/test').Page,
  command: string,
): Promise<void> {
  // The nested Edit menu is a useful manual entry point, but its hover gap is
  // unnecessarily fragile in a browser regression run. The command palette
  // is the same registered action and keeps this test on a real user path.
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible({ timeout: 15000 });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  const label = `${command} Selection`;
  await search.fill(label);
  await palette.getByRole('option', { name: label, exact: true }).first().click();
  await expect(palette).toBeHidden({ timeout: 10000 });
}

async function openSelectionSources(page: import('@playwright/test').Page) {
  const panel = page.getByTestId('selection-sources-panel');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Selection Sources' }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

async function createSmallRasterDocument(page: import('@playwright/test').Page): Promise<void> {
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
}

test.describe('pixel selection refinement', () => {
  test.describe.configure({ timeout: 300000 });

  test('grows a selection, undoes the refinement separately, then saves and exports the restored fill', async ({
    page,
  }, testInfo) => {
    await createSmallRasterDocument(page);
    const toolbar = page.locator('[data-testid="toolbar"]');
    await toolbar.locator('[data-tool="paint"]').click();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor content canvas not found');

    // Create a real raster target, while keeping the later selection in an
    // empty area so the fill geometry is easy to compare in exported pixels.
    await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.22);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 8 });
    await page.mouse.up();
    const rasterRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'Brush Layer' })
      .first();
    await expect(rasterRow).toBeVisible();
    await rasterRow.click();

    await toolbar.locator('[data-tool="marquee"]').click();
    const surface = page.locator('.editor-canvas');
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error('editor canvas surface not found');
    const start = {
      x: surfaceBox.x + surfaceBox.width * 0.52,
      y: surfaceBox.y + surfaceBox.height * 0.25,
    };
    const end = {
      x: surfaceBox.x + surfaceBox.width * 0.7,
      y: surfaceBox.y + surfaceBox.height * 0.43,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();

    const announcer = page.locator('#strata-canvas-announcer-polite');
    await expect(announcer).toContainText(/Rectangular selection/, { timeout: 10000 });

    const sources = await openSelectionSources(page);
    const fill = sources.getByRole('button', { name: 'Fill pixel layer' });
    await expect(fill).toBeEnabled();
    const baseline = await canvas.screenshot();
    const baselineBlack = opaqueBlackPixels(baseline);
    await page.screenshot({ path: testInfo.outputPath('pixel-selection-before-refine.png') });
    // Close the Inspector section before using the menubar. This keeps the
    // command path independent from panel focus and mirrors a normal canvas
    // workflow where the selection remains active while the panel is closed.
    await page.getByRole('button', { name: 'Selection Sources' }).click();

    await openPixelSelectionCommand(page, 'Grow');
    await expect(announcer).toContainText('Selection grown by 1 px', { timeout: 10000 });
    await openSelectionSources(page);
    await fill.click();
    await expect(announcer).toContainText('Selection filled on', { timeout: 10000 });
    const grown = await canvas.screenshot();
    const grownBlack = opaqueBlackPixels(grown);
    expect(grownBlack).toBeGreaterThan(baselineBlack);
    await page.screenshot({ path: testInfo.outputPath('pixel-selection-grown-fill.png') });

    // The first undo removes the raster fill; the second restores the
    // pre-grow selection. Re-filling then proves that the selection history
    // was retained instead of silently discarded by the document edit.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => opaqueBlackPixels(await canvas.screenshot()), { timeout: 15000 })
      .toBeLessThan(grownBlack);
    await openSelectionSources(page);
    await fill.click();
    await expect(announcer).toContainText('Selection filled on', { timeout: 10000 });
    const restored = await canvas.screenshot();
    const restoredBlack = opaqueBlackPixels(restored);
    expect(restoredBlack).toBeGreaterThan(baselineBlack);
    expect(restoredBlack).toBeLessThan(grownBlack);
    await page.screenshot({ path: testInfo.outputPath('pixel-selection-restored-fill.png') });

    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    await page.waitForTimeout(750);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.click();
    const pngGroup = page.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    await pngGroup.getByRole('radio', { name: 'PNG', exact: true }).click();
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const exportDownload = await exportDownloadPromise;
    const exportPath = testInfo.outputPath('pixel-selection-restored.png');
    await exportDownload.saveAs(exportPath);
    const exported = await readFile(exportPath);
    expect(exported.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const exportedPng = PNG.sync.read(exported);
    expect(exportedPng.width).toBe(640);
    expect(exportedPng.height).toBe(480);
    expect(opaqueBlackPixels(exported)).toBeGreaterThan(baselineBlack);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60000,
    });
    await expect
      .poll(
        async () =>
          opaqueBlackPixels(await page.locator('canvas.editor-canvas__content-layer').screenshot()),
        { timeout: 15000 },
      )
      .toBeGreaterThan(baselineBlack);
    await page.screenshot({ path: testInfo.outputPath('pixel-selection-restored-reopened.png') });
  });
});
