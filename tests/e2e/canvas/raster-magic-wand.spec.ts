import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureProducerScreenshot } from '../../../scripts/screenshots/producer-capture.mjs';
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

function opaqueCyanPixels(input: Buffer): number {
  const image = PNG.sync.read(input);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (
      (image.data[offset + 3] ?? 0) > 200 &&
      (image.data[offset] ?? 255) < 40 &&
      (image.data[offset + 1] ?? 0) > 180 &&
      (image.data[offset + 2] ?? 0) > 180
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
  color: 'black' | 'red' | 'blue' | 'cyan',
): Promise<{
  count: number;
  bounds: readonly [number, number, number, number] | null;
}> {
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
        const alphaMatches = expectedColor === 'blue' ? alpha > 48 : alpha > 200;
        const matches =
          alphaMatches &&
          (expectedColor === 'red'
            ? red > 200 && green < 40 && blue < 40
            : expectedColor === 'blue'
              ? red < 120 && green < 160 && blue > 180
              : expectedColor === 'cyan'
                ? red < 40 && green > 180 && blue > 180
                : red < 16 && green < 16 && blue < 16);
        if (!matches) continue;
        count += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return {
      count,
      bounds: count === 0 ? null : ([minX, minY, maxX, maxY] as const),
    };
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

async function screenshotWithoutPerfOverlay(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  filename: string,
): Promise<void> {
  await page.evaluate(() =>
    (
      window as Window & { __varvePerf?: { enable?: (enabled: boolean) => void } }
    ).__varvePerf?.enable?.(false),
  );
  try {
    await forceFullRedraw(page);
    await captureProducerScreenshot(page, testInfo, filename);
  } finally {
    await page.evaluate(() =>
      (
        window as Window & { __varvePerf?: { enable?: (enabled: boolean) => void } }
      ).__varvePerf?.enable?.(true),
    );
  }
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

  test('sketches, inks, fills flats, adds clipped shading, then saves and reopens', async ({
    page,
  }, testInfo) => {
    test.setTimeout(600000);
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
    await newDialog.locator('label.varve-radio').filter({ hasText: 'Start with a frame' }).click();
    await newDialog.getByRole('radio', { name: 'Custom size' }).click();
    await newDialog.getByRole('textbox', { name: 'Width' }).fill('640');
    await newDialog.getByRole('textbox', { name: 'Height' }).fill('480');
    await newDialog.getByTestId('create-design-button').click();
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60000,
    });

    await switchWorkspace(page, 'Draw');
    const frameRow = page.getByRole('treeitem').filter({ hasText: 'Custom frame' }).first();
    await expect(frameRow).toBeVisible();
    await frameRow.click();
    await page.getByRole('button', { name: 'Fit selection to viewport' }).click({ timeout: 15000 });
    await page.keyboard.press('Escape');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect
      .poll(async () => page.evaluate(() => Boolean(window.__varveIsoTest?.worldToScreen)))
      .toBe(true);

    // Start with an actual editable raster sketch pass. The following imported
    // transparent linework acts as the clean ink pass, so the rest of this test
    // qualifies one continuous sketch → ink → flats → clipped-shading project.
    const paintTool = page.locator('[data-testid="toolbar"] [data-tool="paint"]');
    if (await paintTool.isVisible().catch(() => false)) {
      await paintTool.click();
    } else {
      await page.getByRole('button', { name: /More tools|Overflow/i }).click();
      const paintChoice = page.getByRole('menuitemradio', { name: /^Paint$/i });
      if (await paintChoice.isVisible().catch(() => false)) await paintChoice.click();
      else {
        await page.getByRole('menuitem', { name: 'Raster', exact: true }).click();
        await page.getByRole('menuitemradio', { name: /^Paint$/i }).click();
      }
    }
    const toolOptionsTrigger = page.getByRole('button', { name: 'Tool options' });
    await expect(toolOptionsTrigger).toBeVisible();
    if ((await toolOptionsTrigger.getAttribute('aria-expanded')) !== 'true') {
      await toolOptionsTrigger.click();
    }
    const paintOptions = page.locator('.tool-options__popover');
    const brushBrowser = paintOptions.locator('.brush-browser');
    await brushBrowser.getByText('Pencil', { exact: true }).click();
    await brushBrowser.getByRole('button', { name: 'Sketch Pencil', exact: true }).click();
    // The color field is in the contextual paint toolbar, beside (rather
    // than inside) the preset browser popover in the Draw workspace.
    const sketchColor = page.getByLabel('Foreground color');
    await sketchColor.fill('#244aff');
    const sketchSize = paintOptions.getByLabel('Size');
    await sketchSize.fill('5');
    await sketchSize.press('Enter');
    // The frame remains explicitly selected after changing tools. Respect the
    // paint-target refusal and use its visible recovery action instead of
    // silently painting into some other raster node.
    const recoverPaintTarget = paintOptions.getByRole('button', { name: 'Create paint layer' });
    await expect(recoverPaintTarget).toBeVisible();
    await recoverPaintTarget.click();
    const recoveredPaintLayer = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'Paint Layer' })
      .first();
    await expect(recoveredPaintLayer).toHaveAttribute('aria-selected', 'true');
    await toolOptionsTrigger.click();
    const sketchCanvas = page.locator('canvas.editor-canvas__content-layer');
    const sketchStart = await page.evaluate(() => {
      const hook = (
        window as Window & {
          __varveIsoTest?: { worldToScreen: (x: number, y: number) => { x: number; y: number } };
        }
      ).__varveIsoTest;
      const surface = document.querySelector<HTMLElement>('.editor-canvas');
      if (!hook || !surface) throw new Error('canvas projection helper is unavailable');
      const rect = surface.getBoundingClientRect();
      return [
        [218, 208],
        [231, 195],
        [247, 190],
        [263, 198],
        [276, 210],
      ].map(([x, y]) => {
        const point = hook.worldToScreen(x!, y!);
        return { x: rect.left + point.x, y: rect.top + point.y };
      });
    });
    const beforeSketch = await surfaceHash(page);
    const firstSketchPoint = sketchStart[0]!;
    await page.mouse.move(firstSketchPoint.x, firstSketchPoint.y);
    await page.mouse.down();
    for (const point of sketchStart.slice(1)) {
      await page.mouse.move(point!.x, point!.y, { steps: 3 });
    }
    await page.mouse.up();
    await expect.poll(() => surfaceHash(page), { timeout: 15000 }).not.toBe(beforeSketch);
    await expect
      .poll(async () => (await canvasColorStats(sketchCanvas, 'blue')).count, { timeout: 15000 })
      .toBeGreaterThan(20);
    await expect(recoveredPaintLayer).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('illustration-raster-sketch.png') });

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
    const wandOptionsTrigger = page.getByRole('button', { name: 'Tool options' });
    if ((await wandOptionsTrigger.getAttribute('aria-expanded')) === 'true') {
      await wandOptionsTrigger.click();
    }
    await page.getByTestId('magicwand-options').waitFor({ state: 'hidden' });
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
    const flatsRow = page.getByRole('treeitem', { name: 'Flats, Raster layer' });
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
    await screenshotWithoutPerfOverlay(page, testInfo, 'hybrid-linework-flats-filled.png');

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

    // Add editable cyan shading to the ordinary Flats raster via the same
    // alpha-clipping action artists use on any raster source. The gesture
    // extends beyond the contour, while the exported pixels must stay within it.
    await flatsRow.click();
    if (await paintTool.isVisible().catch(() => false)) {
      await paintTool.click();
    } else {
      await page.getByRole('button', { name: /More tools|Overflow/i }).click();
      const paintChoice = page.getByRole('menuitemradio', { name: /^Paint$/i });
      if (await paintChoice.isVisible().catch(() => false)) await paintChoice.click();
      else {
        await page.getByRole('menuitem', { name: 'Raster', exact: true }).click();
        await page.getByRole('menuitemradio', { name: /^Paint$/i }).click();
      }
    }
    const shadingOptionsTrigger = page.getByRole('button', { name: 'Tool options' });
    if ((await shadingOptionsTrigger.getAttribute('aria-expanded')) !== 'true') {
      await shadingOptionsTrigger.click();
    }
    const shadingOptions = page.locator('.tool-options__popover');
    await shadingOptions.getByRole('button', { name: 'Create clipped paint layer' }).click();
    const clippedFlatsGroup = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'Flats clipped paint' })
      .first();
    await expect(clippedFlatsGroup).toBeVisible();
    await expect(page.getByRole('treeitem').filter({ hasText: 'Shading' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const shadingBrushBrowser = shadingOptions.locator('.brush-browser');
    await shadingBrushBrowser.getByText('Paint', { exact: true }).click();
    await shadingBrushBrowser.getByRole('button', { name: 'Opaque Paint', exact: true }).click();
    const shadingColor = page.getByLabel('Foreground color');
    await shadingColor.fill('#00e5e5');
    const shadingSize = shadingOptions.getByLabel('Size');
    await shadingSize.fill('54');
    await shadingSize.press('Enter');
    await shadingOptionsTrigger.click();
    const shadePoints = await page.evaluate(() => {
      const hook = (
        window as Window & {
          __varveIsoTest?: { worldToScreen: (x: number, y: number) => { x: number; y: number } };
        }
      ).__varveIsoTest;
      const surface = document.querySelector<HTMLElement>('.editor-canvas');
      if (!hook || !surface) throw new Error('canvas projection helper is unavailable');
      const rect = surface.getBoundingClientRect();
      return [
        [202, 246],
        [236, 248],
        [272, 248],
        [309, 248],
        [346, 248],
        [382, 246],
      ].map(([x, y]) => {
        const point = hook.worldToScreen(x!, y!);
        return { x: rect.left + point.x, y: rect.top + point.y };
      });
    });
    const preShade = await canvasColorStats(canvas, 'cyan');
    const firstShadePoint = shadePoints[0]!;
    await page.mouse.move(firstShadePoint.x, firstShadePoint.y);
    await page.mouse.down();
    for (const point of shadePoints.slice(1)) {
      await page.mouse.move(point!.x, point!.y, { steps: 4 });
    }
    await page.mouse.up();
    await expect
      .poll(async () => (await canvasColorStats(canvas, 'cyan')).count, { timeout: 20000 })
      .toBeGreaterThan(preShade.count + 100);
    const shaded = await canvasColorStats(canvas, 'cyan');
    const flatPixels = await canvasColorStats(canvas, 'red');
    expect(shaded.bounds).not.toBeNull();
    expect(flatPixels.bounds).not.toBeNull();
    const [shadeLeft, shadeTop, shadeRight, shadeBottom] = shaded.bounds!;
    const [flatLeft, flatTop, flatRight, flatBottom] = flatPixels.bounds!;
    // Raster edge coverage is antialiased at the current zoom. Permit a few
    // display pixels at the contour edge while still rejecting any unbounded
    // stroke that escapes the filled shape.
    expect(shadeLeft).toBeGreaterThanOrEqual(flatLeft - 5);
    expect(shadeTop).toBeGreaterThanOrEqual(flatTop - 5);
    expect(shadeRight).toBeLessThanOrEqual(flatRight + 5);
    expect(shadeBottom).toBeLessThanOrEqual(flatBottom + 5);
    await screenshotWithoutPerfOverlay(page, testInfo, 'illustration-clipped-flats-shading.png');
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await canvasColorStats(canvas, 'cyan')).count, { timeout: 15000 })
      .toBe(preShade.count);
    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(async () => (await canvasColorStats(canvas, 'cyan')).count, { timeout: 15000 })
      .toBeGreaterThan(preShade.count + 100);
    await page.screenshot({
      path: testInfo.outputPath('illustration-sketch-ink-flats-shading.png'),
    });

    // Export the editable linework and flats together as one composed artwork
    // item. The Inspector's compact Export controls export only the selected
    // node, so grouping preserves both child layers while giving that route a
    // single truthful PNG appearance.
    await flatsRow.click();
    await clippedFlatsGroup.click({ modifiers: ['Control'] });
    await rasterRow.click({ modifiers: ['Control'] });
    await recoveredPaintLayer.click({ modifiers: ['Control'] });
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
    // Outward rounding may add a single pixel when imported selection bounds
    // land fractionally off the integer grid; a smaller export would crop the
    // source edge, while a larger one would indicate a real bounds error.
    expect(exportedPng.width).toBeGreaterThanOrEqual(4096);
    expect(exportedPng.width).toBeLessThanOrEqual(4097);
    expect(exportedPng.height).toBeGreaterThanOrEqual(4096);
    expect(exportedPng.height).toBeLessThanOrEqual(4097);
    expect(opaqueBlackPixels(exported)).toBeGreaterThan(100);
    expect(opaqueRedPixels(exported)).toBeGreaterThan(5000);
    expect(opaqueCyanPixels(exported)).toBeGreaterThan(1000);
    const edgeSamples: ReadonlyArray<readonly [number, number]> = [
      [8, 8],
      [exportedPng.width - 9, 8],
      [8, exportedPng.height - 9],
      [exportedPng.width - 9, exportedPng.height - 9],
    ];
    for (const [x, y] of edgeSamples) {
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
    // The design surface has no active publishing page. Fit the imported
    // 640×480 linework bounds so the whole reopened composition is in view.
    await expect(rasterRow).toBeVisible({ timeout: 15000 });
    await rasterRow.click();
    await page.getByRole('button', { name: 'Fit selection to viewport' }).click({ timeout: 15000 });
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
