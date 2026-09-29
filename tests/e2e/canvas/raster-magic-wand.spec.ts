import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { switchWorkspace } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
type PngPixels = { width: number; height: number; data: Buffer };
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    new (options: { width: number; height: number }): PngPixels;
    sync: {
      read(input: Buffer): PngPixels;
      write(input: PngPixels): Buffer;
    };
  };
};

function createTransparentLineArt(): Buffer {
  const image = new PNG({ width: 640, height: 480 });
  image.data.fill(0);
  const drawStroke = (points: readonly (readonly [number, number])[], width: number) => {
    for (let segment = 0; segment < points.length; segment += 1) {
      const start = points[segment];
      const end = points[(segment + 1) % points.length];
      if (!start || !end) continue;
      const [x1, y1] = start;
      const [x2, y2] = end;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      const radius = width / 2 + 1;
      const left = Math.max(0, Math.floor(Math.min(x1, x2) - radius));
      const top = Math.max(0, Math.floor(Math.min(y1, y2) - radius));
      const right = Math.min(image.width - 1, Math.ceil(Math.max(x1, x2) + radius));
      const bottom = Math.min(image.height - 1, Math.ceil(Math.max(y1, y2) + radius));
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const t =
            lengthSquared === 0
              ? 0
              : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
          const nearestX = x1 + t * dx;
          const nearestY = y1 + t * dy;
          const distance = Math.hypot(x - nearestX, y - nearestY);
          const coverage = Math.max(0, Math.min(1, width / 2 + 0.5 - distance));
          const offset = (y * image.width + x) * 4;
          image.data[offset] = 0;
          image.data[offset + 1] = 0;
          image.data[offset + 2] = 0;
          image.data[offset + 3] = Math.max(
            image.data[offset + 3] ?? 0,
            Math.round(coverage * 255),
          );
        }
      }
    }
  };
  const appleOutline: ReadonlyArray<readonly [number, number]> = [
    [320, 136],
    [304, 122],
    [283, 113],
    [259, 116],
    [234, 127],
    [211, 143],
    [192, 166],
    [179, 194],
    [173, 226],
    [178, 260],
    [192, 292],
    [213, 320],
    [241, 339],
    [271, 349],
    [298, 347],
    [320, 338],
    [342, 347],
    [369, 349],
    [399, 339],
    [427, 320],
    [448, 292],
    [462, 260],
    [467, 226],
    [461, 194],
    [448, 166],
    [429, 143],
    [406, 127],
    [381, 116],
    [357, 113],
    [336, 122],
  ];
  drawStroke(appleOutline, 9);
  drawStroke(
    [
      [320, 137],
      [330, 116],
      [336, 92],
    ],
    9,
  );
  drawStroke(
    [
      [330, 112],
      [347, 91],
      [372, 84],
      [366, 104],
      [350, 117],
    ],
    6,
  );
  return PNG.sync.write(image);
}

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

function opaqueRedPixels(input: Buffer): number {
  const image = PNG.sync.read(input);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (
      (image.data[offset + 3] ?? 0) > 200 &&
      (image.data[offset] ?? 0) > 200 &&
      (image.data[offset + 1] ?? 255) < 40 &&
      (image.data[offset + 2] ?? 255) < 40
    ) {
      count += 1;
    }
  }
  return count;
}

function opaqueRedPixelsAt(data: Buffer, offset: number): boolean {
  return (
    (data[offset + 3] ?? 0) > 200 &&
    (data[offset] ?? 0) > 200 &&
    (data[offset + 1] ?? 255) < 40 &&
    (data[offset + 2] ?? 255) < 40
  );
}

async function surfaceHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas context unavailable');
    return crypto.subtle
      .digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data)
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
  });
}

async function canvasColorStats(
  canvas: import('@playwright/test').Locator,
  color: 'black' | 'red',
): Promise<{ count: number; bounds: number[] | null }> {
  return canvas.evaluate((element, expectedColor) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('canvas context unavailable');
    const { data, width, height } = context.getImageData(0, 0, surface.width, surface.height);
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3] ?? 0;
        const red = data[offset] ?? 0;
        const green = data[offset + 1] ?? 0;
        const blue = data[offset + 2] ?? 0;
        const matches =
          alpha > 200 &&
          (expectedColor === 'red'
            ? red > 200 && green < 40 && blue < 40
            : red < 16 && green < 16 && blue < 16);
        if (!matches) continue;
        count += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return { count, bounds: count === 0 ? null : [minX, minY, maxX, maxY] };
  }, color);
}

async function storeCanvasPixels(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data.slice();
    Object.assign(window, {
      __varveIllustrationReferencePixels: { width: canvas.width, height: canvas.height, pixels },
    });
  });
}

async function compareCanvasToStored(page: import('@playwright/test').Page): Promise<{
  totalPixels: number;
  changedPixels: number;
  redUnion: number;
  redMismatch: number;
  redMismatchRate: number;
}> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas context unavailable');
    const reference = (
      window as unknown as {
        __varveIllustrationReferencePixels?: {
          width: number;
          height: number;
          pixels: Uint8ClampedArray;
        };
      }
    ).__varveIllustrationReferencePixels;
    if (!reference) throw new Error('stored raster comparison frame is unavailable');
    if (reference.width !== canvas.width || reference.height !== canvas.height) {
      throw new Error('canvas dimensions changed during the raster comparison');
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let changedPixels = 0;
    let redUnion = 0;
    let redMismatch = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        pixels[offset] !== reference.pixels[offset] ||
        pixels[offset + 1] !== reference.pixels[offset + 1] ||
        pixels[offset + 2] !== reference.pixels[offset + 2] ||
        pixels[offset + 3] !== reference.pixels[offset + 3]
      ) {
        changedPixels += 1;
      }
      const currentRed =
        (pixels[offset + 3] ?? 0) > 200 &&
        (pixels[offset] ?? 0) > 200 &&
        (pixels[offset + 1] ?? 255) < 40 &&
        (pixels[offset + 2] ?? 255) < 40;
      const referenceRed =
        (reference.pixels[offset + 3] ?? 0) > 200 &&
        (reference.pixels[offset] ?? 0) > 200 &&
        (reference.pixels[offset + 1] ?? 255) < 40 &&
        (reference.pixels[offset + 2] ?? 255) < 40;
      if (currentRed || referenceRed) redUnion += 1;
      if (currentRed !== referenceRed) redMismatch += 1;
    }
    return {
      totalPixels: canvas.width * canvas.height,
      changedPixels,
      redUnion,
      redMismatch,
      redMismatchRate: redUnion === 0 ? 0 : redMismatch / redUnion,
    };
  });
}

async function renderDebugState(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(() => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
          renderPath?: () => unknown;
          workerStatus?: () => unknown;
          scheduler?: () => unknown;
          rasterLod?: { enabled?: () => unknown; diagnostics?: () => unknown };
        };
      }
    ).__varvePerf;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const rect = canvas?.getBoundingClientRect();
    return {
      canvas: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            cssWidth: rect?.width,
            cssHeight: rect?.height,
            dpr: window.devicePixelRatio,
          }
        : null,
      renderPath: perf?.renderPath?.(),
      worker: perf?.workerStatus?.(),
      scheduler: perf?.scheduler?.(),
      rasterLod: {
        enabled: perf?.rasterLod?.enabled?.(),
        diagnostics: perf?.rasterLod?.diagnostics?.(),
      },
    };
  });
}

async function forceFullRedraw(page: import('@playwright/test').Page): Promise<void> {
  const result = await page.evaluate(async () =>
    (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean; renderPath: string }>;
        };
      }
    ).__varvePerf?.forceFullRedraw?.(),
  );
  expect(result, 'full-redraw oracle must be installed').toBeTruthy();
  expect(result?.authoritative).toBe(true);
  expect(['compositor', 'structural']).toContain(result?.renderPath);
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

const VIEWPORT = { width: 1280, height: 800 };

test.describe('hybrid illustration Magic Wand workflow', () => {
  test.describe.configure({ timeout: 300000 });

  test('samples closed raster linework into a separate flats layer, then saves and reopens', async ({
    page,
  }, testInfo) => {
    page.on('pageerror', (error) =>
      console.error(`[hybrid workflow pageerror] ${error.stack ?? error.message}`),
    );
    page.on('crash', () => console.error('[hybrid workflow] browser page crashed'));
    await page.addInitScript(() => localStorage.setItem('varve.renderWorker', 'off'));
    await page.setViewportSize(VIEWPORT);
    await page.goto('/?isoTest=1&perf=1');
    const staleSafeMode = await page.evaluate(
      () => localStorage.getItem('varve:safe-mode') !== null,
    );
    if (staleSafeMode) {
      await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    const continueNormalStartup = page.getByRole('button', { name: /continue normal startup/i });
    if (await continueNormalStartup.isVisible({ timeout: 1000 }).catch(() => false)) {
      await continueNormalStartup.click();
      await page.locator('.safe-mode-screen').waitFor({ state: 'hidden', timeout: 10000 });
    }
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 45000 });
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

    await switchWorkspace(page, 'Draw');
    await page.getByRole('button', { name: 'Fit active page' }).click();
    await expect
      .poll(async () => page.evaluate(() => Boolean(window.__varveIsoTest?.worldToScreen)))
      .toBe(true);
    await page.locator('#file-import-input').setInputFiles({
      name: 'line-art.png',
      mimeType: 'image/png',
      buffer: createTransparentLineArt(),
    });
    const rasterRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'line-art.png' })
      .first();
    await expect(rasterRow).toBeVisible({ timeout: 30000 });
    await rasterRow.click();
    await page.waitForTimeout(500);

    // Visible artwork samples the whole rendered active surface, while the
    // later selection action chooses a separate empty flats destination.
    await page.keyboard.press('Shift+W');
    await expect(page.getByTestId('magicwand-options')).toBeVisible({ timeout: 10000 });
    await page
      .getByRole('radiogroup', { name: 'Sample source' })
      .getByText('Visible artwork', { exact: true })
      .click();
    const gapClosure = page.getByLabel('Selection gap closure radius');
    await gapClosure.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, '1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(gapClosure).toHaveValue('1');
    const edgeExpansion = page.getByLabel('Selection edge expansion');
    await edgeExpansion.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, '1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(edgeExpansion).toHaveValue('1');
    const clickPoint = await page.evaluate(() => {
      const hook = (
        window as Window & {
          __varveIsoTest?: { worldToScreen: (x: number, y: number) => { x: number; y: number } };
        }
      ).__varveIsoTest;
      const surface = document.querySelector<HTMLElement>('.editor-canvas');
      if (!hook || !surface) throw new Error('canvas projection helper is unavailable');
      const rect = surface.getBoundingClientRect();
      const point = hook.worldToScreen(240, 210);
      return { x: rect.left + point.x, y: rect.top + point.y };
    });
    await page.screenshot({ path: testInfo.outputPath('hybrid-linework-before-fill.png') });
    await page.mouse.click(clickPoint.x, clickPoint.y);

    const announcer = page.locator('#strata-canvas-announcer-polite');
    await expect(announcer).toContainText(/visible-artwork Magic Wand selection created/i, {
      timeout: 15000,
    });
    await page.screenshot({ path: testInfo.outputPath('hybrid-linework-selection.png') });

    await page.getByRole('button', { name: 'Selection Sources' }).click();
    const sources = page.getByTestId('selection-sources-panel');
    const flatsLayer = sources.getByRole('button', { name: 'Create flats layer' });
    await expect(flatsLayer).toBeVisible();
    await flatsLayer.click();
    const flatsRow = page.locator('[role="treeitem"][data-node-id]').filter({ hasText: 'Flats' });
    await expect(flatsRow).toHaveAttribute('aria-selected', 'true');
    const fillColor = sources.getByLabel('Fill color');
    await fillColor.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, '#ff0000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(fillColor).toHaveValue('#ff0000');
    const fill = sources.getByRole('button', { name: 'Fill pixel layer' });
    await expect(fill).toBeEnabled();
    await fill.click();
    await expect(announcer).toContainText('Selection filled on', { timeout: 15000 });
    await expect
      .poll(async () => (await canvasColorStats(canvas, 'red')).count, { timeout: 20000 })
      .toBeGreaterThan(1000);
    await expect(page.locator('.editor-shell')).toBeVisible();
    await expect(page.locator('.safe-mode-screen')).toBeHidden();
    expect((await canvasColorStats(canvas, 'black')).count).toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath('hybrid-linework-flats-filled.png') });

    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Undo/ })
      .click();
    await page.waitForTimeout(300);
    const undoLiveHash = await surfaceHash(page);
    await page.screenshot({
      path: testInfo.outputPath('hybrid-linework-flats-undo-before-redraw.png'),
    });
    await forceFullRedraw(page);
    const undoAuthoritativeHash = await surfaceHash(page);
    const afterUndo = await canvasColorStats(canvas, 'red');
    console.log(`[hybrid workflow] undo artwork pixels ${JSON.stringify(afterUndo)}`);
    expect(undoLiveHash, 'Undo must leave the same pixels as an authoritative full redraw').toBe(
      undoAuthoritativeHash,
    );
    await page.screenshot({ path: testInfo.outputPath('hybrid-linework-flats-undo.png') });
    await expect
      .poll(async () => (await canvasColorStats(canvas, 'red')).count, { timeout: 15000 })
      .toBe(0);
    expect((await canvasColorStats(canvas, 'black')).count).toBeGreaterThan(100);
    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Redo/ })
      .click();
    await expect
      .poll(async () => (await canvasColorStats(canvas, 'red')).count, { timeout: 15000 })
      .toBeGreaterThan(1000);
    await page.screenshot({ path: testInfo.outputPath('hybrid-linework-flats-redo.png') });

    // Export the editable linework and flats together as one composed artwork
    // item. The Inspector's compact Export controls export only the selected
    // node, so grouping preserves both child layers while giving that route a
    // single truthful PNG appearance.
    await flatsRow.click();
    await rasterRow.click({ modifiers: ['Control'] });
    await page.getByRole('tree', { name: /layers/i }).press('Control+g');
    const artworkGroup = page.locator('[role="treeitem"][aria-selected="true"]');
    await expect(artworkGroup).toContainText(/Group/);

    // Prove the artwork fill survives the durable save, PNG export, and
    // Home-library reopen path rather than merely leaving a live selection.
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

    await selectExportTab(page);
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
    expect(exportedPng.width).toBe(4096);
    expect(exportedPng.height).toBe(4096);
    expect(opaqueBlackPixels(exported)).toBeGreaterThan(100);
    expect(opaqueRedPixels(exported)).toBeGreaterThan(5000);
    for (const [x, y] of [
      [8, 8],
      [4087, 8],
      [8, 4087],
      [4087, 4087],
    ] as const) {
      const offset = (y * exportedPng.width + x) * 4;
      const opaqueBlack =
        (exportedPng.data[offset + 3] ?? 0) > 200 &&
        (exportedPng.data[offset] ?? 255) < 16 &&
        (exportedPng.data[offset + 1] ?? 255) < 16 &&
        (exportedPng.data[offset + 2] ?? 255) < 16;
      expect(opaqueBlack, `fill remains inside the artwork away from corner (${x}, ${y})`).toBe(
        false,
      );
      expect(
        opaqueRedPixelsAt(exportedPng.data, offset),
        `flat color stays within the outline`,
      ).toBe(false);
      expect(exportedPng.data[offset + 3]).toBe(0);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60000,
    });
    await expect(page.locator('[role="treeitem"][data-node-id]')).not.toHaveCount(0);
    await page.getByRole('button', { name: 'Fit active page' }).click();
    const reopenedCanvas = page.locator('canvas.editor-canvas__content-layer');
    await expect
      .poll(async () => (await canvasColorStats(reopenedCanvas, 'red')).count, { timeout: 15000 })
      .toBeGreaterThan(1000);
    expect((await canvasColorStats(reopenedCanvas, 'black')).count).toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath('raster-magic-wand-reopened.png') });
    const reopenedWorkerHash = await surfaceHash(page);
    const reopenedBeforeState = await renderDebugState(page);
    const reopenedRenderedPixels = await canvasColorStats(reopenedCanvas, 'red');
    expect(
      (reopenedBeforeState as { rasterLod?: { enabled?: boolean } }).rasterLod?.enabled,
      'unqualified interactive raster LOD stays out of the default editor render path',
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath('hybrid-reopened-before-full-redraw.png'),
    });
    await storeCanvasPixels(page);
    await page.evaluate(() => {
      (
        window as unknown as {
          __varvePerf?: { rasterLod?: { disable?: () => void } };
        }
      ).__varvePerf?.rasterLod?.disable?.();
    });
    await forceFullRedraw(page);
    const reopenedCompositorHash = await surfaceHash(page);
    const retainedRedPixels = await canvasColorStats(reopenedCanvas, 'red');
    const rasterComparison = await compareCanvasToStored(page);
    const reopenedAfterState = await renderDebugState(page);
    await page.screenshot({
      path: testInfo.outputPath('hybrid-reopened-after-full-redraw.png'),
    });
    console.log(
      `[hybrid workflow] reopened frame vs retained redraw ${JSON.stringify({ reopenedRenderedPixels, retainedRedPixels, rasterComparison, reopenedBeforeState, reopenedAfterState, reopenedWorkerHash, reopenedCompositorHash })}`,
    );
    expect(
      rasterComparison.redMismatchRate,
      `reopened artwork must match the authoritative retained-layer render at the same camera; ${JSON.stringify({ reopenedRenderedPixels, retainedRedPixels, rasterComparison, reopenedBeforeState, reopenedAfterState })}`,
    ).toBeLessThan(0.05);
    await page.evaluate(() => {
      (
        window as Window & { __varvePerf?: { enable?: (enabled: boolean) => void } }
      ).__varvePerf?.enable?.(false);
    });
    await forceFullRedraw(page);

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await page.screenshot({ path: testInfo.outputPath(`hybrid-reopened-${theme}.png`) });
    }
    await page.setViewportSize({ width: 960, height: 720 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect
      .poll(
        async () =>
          page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
            const canvas = element as HTMLCanvasElement;
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            return (
              canvas.width === Math.round(rect.width * dpr) &&
              canvas.height === Math.round(rect.height * dpr)
            );
          }),
        { timeout: 10000 },
      )
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: testInfo.outputPath('hybrid-reopened-narrow-before-full-redraw.png'),
    });
    const liveNarrowHash = await surfaceHash(page);
    const liveNarrowDebug = await renderDebugState(page);
    await forceFullRedraw(page);
    const authoritativeNarrowHash = await surfaceHash(page);
    const authoritativeNarrowDebug = await renderDebugState(page);
    await page.screenshot({
      path: testInfo.outputPath('hybrid-reopened-narrow-after-full-redraw.png'),
    });
    expect(
      liveNarrowHash,
      `narrow canvas must match the full-redraw oracle; before=${JSON.stringify(liveNarrowDebug)} after=${JSON.stringify(authoritativeNarrowDebug)}`,
    ).toBe(authoritativeNarrowHash);
    await page.screenshot({ path: testInfo.outputPath('hybrid-reopened-narrow.png') });
  });
});
