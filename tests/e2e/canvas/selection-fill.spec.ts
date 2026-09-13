import { expect, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

test.describe('selection-to-flats workflow', () => {
  test('fills a selected pixel layer through Selection Sources and undoes it', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
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

    const rasterRow = page.locator('[role="treeitem"][data-node-id]').last();
    await rasterRow.click();
    await toolbar.locator('[data-tool="marquee"]').click();

    const before = await canvas.screenshot();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.76, box.y + box.height * 0.66, { steps: 6 });
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
    await page.screenshot({ path: testInfo.outputPath('selection-fill-after.png') });

    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => Buffer.compare(after, await canvas.screenshot()), { timeout: 10000 })
      .not.toBe(0);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-undo.png') });

    // Restore the filled state, save it through the ordinary File command,
    // export the actual raster, then reopen the saved document. The browser
    // fallback is used so this test does not wait on a native file picker.
    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(async () => Buffer.compare(after, await canvas.screenshot()), { timeout: 10000 })
      .toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    const saveDownloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Save\s+Ctrl\+S$/i }).click();
    const saveDownload = await saveDownloadPromise;
    await saveDownload.saveAs(testInfo.outputPath('selection-fill.varve'));
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.click();
    const pngGroup = page.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    await pngGroup.getByRole('button', { name: 'PNG', exact: true }).click();
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await pngGroup.getByRole('button', { name: /download/i }).click();
    const exportDownload = await exportDownloadPromise;
    await exportDownload.saveAs(testInfo.outputPath('selection-fill.png'));
    const { readFile } = await import('node:fs/promises');
    const exported = await readFile(testInfo.outputPath('selection-fill.png'));
    expect(exported.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60000,
    });
    await expect(page.locator('[role="treeitem"][data-node-id]')).not.toHaveCount(0);
    const reopened = await page.locator('canvas.editor-canvas__content-layer').screenshot();
    expect(Buffer.compare(before, reopened)).not.toBe(0);
    await page.screenshot({ path: testInfo.outputPath('selection-fill-reopened.png') });
  });
});
