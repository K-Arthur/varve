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

async function selectExportTab(page: import('@playwright/test').Page): Promise<void> {
  const exportTab = page
    .getByRole('tablist', { name: 'Inspector tabs' })
    .getByRole('tab', { name: 'Export', exact: true });
  if (await exportTab.isVisible().catch(() => false)) {
    await exportTab.click();
  } else {
    await page.getByRole('button', { name: /More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
  await page.locator('#insp-sub-tab-format').waitFor({ state: 'visible', timeout: 10000 });
}

async function selectMarqueeTool(page: import('@playwright/test').Page): Promise<void> {
  const toolbar = page.getByTestId('toolbar');
  const directTool = toolbar.locator('[data-tool="marquee"]');
  if (await directTool.isVisible().catch(() => false)) {
    await directTool.click();
    await expect(page.locator('.editor-status')).toContainText('Rectangular Marquee');
    return;
  }

  // Responsive toolbar slots move into the category-based overflow menu at
  // common editor widths. Use the same visible route an artist uses there.
  await toolbar.getByRole('button', { name: /More tools/ }).click();
  await page.locator('.varve-ctxmenu').getByText('Selection', { exact: true }).click();
  const selectionMenu = page.getByRole('menu', { name: 'Selection submenu', exact: true });
  await expect(selectionMenu).toBeVisible();
  const marqueeItem = selectionMenu.getByRole('menuitem', {
    name: 'Rectangular Marquee',
    exact: true,
  });
  await expect(marqueeItem).toBeVisible();
  await marqueeItem.click({ timeout: 5000 });
  await expect(page.locator('.editor-status')).toContainText('Rectangular Marquee');
}

// Keep the full Photo tool row visible here so the workflow assertion targets
// selection/fill semantics; responsive overflow has its own dedicated E2E.
const VIEWPORT = { width: 2400, height: 1200 };

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
    // Creating and resizing the page leaves the initial camera partially
    // panned on this wide viewport. Center the page so both the paint stroke
    // and the subsequent marquee operate on the same artwork pixels.
    await page.getByRole('button', { name: 'Fit active page' }).click();
    await expect(page.locator('.editor-shell')).toBeVisible();
    const layerQuickFilters = page.getByRole('group', { name: 'Workspace filters' });
    if (await layerQuickFilters.isVisible().catch(() => false)) {
      const activeFilters = layerQuickFilters.getByRole('button', { pressed: true });
      while ((await activeFilters.count()) > 0) await activeFilters.first().click();
    }

    const toolbar = page.locator('[data-testid="toolbar"]');
    const paintTool = toolbar.locator('[data-tool="paint"]');
    await paintTool.click();
    await expect(paintTool).toHaveAttribute('aria-pressed', 'true');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor content canvas not found');

    await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.49, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => opaqueBlackPixels(await canvas.screenshot()), { timeout: 10000 })
      .toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-painted-underlay.png') });
    const rasterRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'Brush Layer' })
      .first();
    await expect(rasterRow).toBeVisible({ timeout: 10000 });

    await rasterRow.click();
    await expect(rasterRow).toHaveAttribute('aria-selected', 'true');
    await selectMarqueeTool(page);
    await expect(
      page.locator('.workspace-dock__item[aria-label="Photo workspace"]'),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(rasterRow).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('selection-fill-target-retained.png') });
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
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Rectangular selection,',
    );
    await expect(rasterRow).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('selection-fill-marquee.png') });

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

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect
      .poll(async () => Buffer.compare(after, await canvas.screenshot()), { timeout: 10000 })
      .not.toBe(0);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-undo.png') });

    // Restore the filled state, save it through the ordinary Ctrl+S command,
    // export the actual raster, then reopen the saved document. The browser
    // fallback is used so this test does not wait on a native file picker.
    await page.getByRole('button', { name: /^Redo/ }).click();
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

    await selectExportTab(page);
    const pngGroup = page.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    await pngGroup.getByRole('radio', { name: 'PNG', exact: true }).click();
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
    await page.getByRole('button', { name: 'Fit active page' }).click();
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
