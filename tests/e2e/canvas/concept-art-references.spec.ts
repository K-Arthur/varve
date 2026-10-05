import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureProducerScreenshot } from '../../../scripts/screenshots/producer-capture.mjs';
import { openMenu } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
type PngPixels = { width: number; height: number; data: Buffer };
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    new (options: { width: number; height: number }): PngPixels;
    sync: {
      write(input: PngPixels): Buffer;
      read(input: Buffer): PngPixels;
    };
  };
};

const VIEWPORT = { width: 1280, height: 800 };
const PIXEL_ORACLE_CSS_SIZE = { width: 640, height: 480 };

const REFERENCE_FIXTURE = join(process.cwd(), 'tests/e2e/fixtures/real-life-beech-forest.jpg');

async function rawContentHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element, oracleSize) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas context unavailable');
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    const { width, height } = oracleSize;
    if (bounds.width < width || bounds.height < height) {
      throw new Error(`content canvas is smaller than the ${width}x${height} CSS-pixel oracle`);
    }

    // Read the same top-left viewport crop on every poll. Hashing the complete
    // backing store makes unrelated canvas-height changes look like artwork
    // changes even when every sampled pixel is identical.
    const oracle = document.createElement('canvas');
    oracle.width = width;
    oracle.height = height;
    const oracleContext = oracle.getContext('2d');
    if (!oracleContext) throw new Error('pixel oracle context unavailable');
    oracleContext.drawImage(canvas, 0, 0, width * scaleX, height * scaleY, 0, 0, width, height);
    return crypto.subtle
      .digest('SHA-256', oracleContext.getImageData(0, 0, width, height).data)
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
  }, PIXEL_ORACLE_CSS_SIZE);
}

async function contentHash(page: import('@playwright/test').Page): Promise<string> {
  let previous = '';
  let unchanged = 0;
  // Fit Selection animates for 300ms. Compare settled pixels so a metadata
  // toggle is not compared with an intermediate camera-animation frame.
  await expect
    .poll(
      async () => {
        const current = await rawContentHash(page);
        unchanged = current === previous ? unchanged + 1 : 0;
        previous = current;
        return unchanged;
      },
      { timeout: 15000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
  return previous;
}

async function cameraFingerprint(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const hook = (
      window as Window & {
        __varveIsoTest?: { worldToScreen: (x: number, y: number) => { x: number; y: number } };
      }
    ).__varveIsoTest;
    const surface = document.querySelector<HTMLElement>('.editor-canvas');
    if (!hook || !surface) throw new Error('camera projection helper is unavailable');
    const rect = surface.getBoundingClientRect();
    return JSON.stringify({
      origin: hook.worldToScreen(0, 0),
      unitX: hook.worldToScreen(1, 0),
      unitY: hook.worldToScreen(0, 1),
      bounds: [rect.left, rect.top, rect.width, rect.height],
    });
  });
}

async function forceFullRedraw(page: import('@playwright/test').Page): Promise<void> {
  const result = (await page.evaluate(async () => {
    return (
      window as Window & {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean; renderPath: string }>;
        };
      }
    ).__varvePerf?.forceFullRedraw?.();
  })) as { authoritative: boolean; renderPath: string } | undefined;
  expect(result, 'full-redraw pixel oracle must be installed').toBeTruthy();
  expect(result?.authoritative, 'pixel oracle must commit a fresh full frame').toBe(true);
}

async function expectSurfaceMatchesFullRedraw(
  page: import('@playwright/test').Page,
  label: string,
): Promise<void> {
  const liveHash = await contentHash(page);
  const cameraBeforeRedraw = await cameraFingerprint(page);
  await forceFullRedraw(page);
  expect(await cameraFingerprint(page), `${label}: redraw must keep the camera fixed`).toBe(
    cameraBeforeRedraw,
  );
  const authoritativeHash = await contentHash(page);
  console.info(
    `[paint undo pixel oracle] ${label} cameraStable=true live=${liveHash} authoritative=${authoritativeHash}`,
  );
  expect(liveHash, `${label}: live pixels must match a same-camera full redraw`).toBe(
    authoritativeHash,
  );
}

async function coloredPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      if (
        (pixels[offset + 3] ?? 0) > 200 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) > 32
      ) {
        count += 1;
      }
    }
    return count;
  });
}

function countReferenceColor(bytes: Buffer): number {
  const png = PNG.sync.read(bytes);
  let count = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const red = png.data[offset] ?? 0;
    const green = png.data[offset + 1] ?? 0;
    const blue = png.data[offset + 2] ?? 0;
    if (
      (png.data[offset + 3] ?? 0) > 200 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) > 32
    ) {
      count += 1;
    }
  }
  return count;
}

async function selectExportTab(page: import('@playwright/test').Page) {
  const tab = page.getByRole('tab', { name: 'Export', exact: true });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
}

async function closeMagicWandOptions(page: import('@playwright/test').Page) {
  const options = page.getByTestId('magicwand-options');
  await expect(options).toBeVisible();
  await page.getByRole('button', { name: 'Tool options' }).click();
  await expect(options).toBeHidden();
}

async function referencePoint(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const hook = (
      window as Window & {
        __varveIsoTest?: { worldToScreen: (x: number, y: number) => { x: number; y: number } };
      }
    ).__varveIsoTest;
    const surface = document.querySelector<HTMLElement>('.editor-canvas');
    if (!hook || !surface) throw new Error('canvas projection helper is unavailable');
    const rect = surface.getBoundingClientRect();
    const point = hook.worldToScreen(320, 240);
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
}

async function conceptScreenPoint(page: import('@playwright/test').Page, x: number, y: number) {
  return page.evaluate(
    ({ worldX, worldY }) => {
      const hook = (
        window as Window & {
          __varveIsoTest?: { worldToScreen: (x: number, y: number) => { x: number; y: number } };
        }
      ).__varveIsoTest;
      const surface = document.querySelector<HTMLElement>('.editor-canvas');
      if (!hook || !surface) throw new Error('canvas projection helper is unavailable');
      const rect = surface.getBoundingClientRect();
      const point = hook.worldToScreen(worldX, worldY);
      return { x: rect.left + point.x, y: rect.top + point.y };
    },
    { worldX: x, worldY: y },
  );
}

async function drawConceptRect(
  page: import('@playwright/test').Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  toolId: 'frame' | 'rect',
) {
  const tool = page.locator(`.floating-toolbar [data-tool="${toolId}"]`);
  await expect(tool).toBeVisible();
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  const start = await conceptScreenPoint(page, x1, y1);
  const end = await conceptScreenPoint(page, x2, y2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

async function orangePaintPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) throw new Error('content canvas is unavailable');
    let count = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (
        (data[offset + 3] ?? 0) > 128 &&
        (data[offset] ?? 0) > 180 &&
        (data[offset + 1] ?? 0) > 60 &&
        (data[offset + 1] ?? 255) < 190 &&
        (data[offset + 2] ?? 255) < 80
      ) {
        count += 1;
      }
    }
    return count;
  });
}

async function selectConceptFrameAtX(page: import('@playwright/test').Page, expectedX: number) {
  const frames = page.locator('[role="treeitem"][data-layer-type="frame"]');
  const xField = page.getByRole('spinbutton', { name: 'X (px)' });
  for (let index = 0; index < (await frames.count()); index += 1) {
    await frames.nth(index).click();
    if (Number(await xField.inputValue()) === expectedX) return;
  }
  throw new Error(`no concept frame found at x=${expectedX}`);
}

test.describe('concept-art reference workflow', () => {
  test.describe.configure({ timeout: 240000 });

  test('keeps a reference visible, gates sampling, and saves the opt-in', async ({
    page,
  }, info) => {
    await page.addInitScript(() => localStorage.setItem('varve.renderWorker', 'off'));
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page, '/?isoTest=1');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.locator('#file-import-input').setInputFiles({
      name: 'beech-forest.jpg',
      mimeType: 'image/jpeg',
      buffer: readFileSync(REFERENCE_FIXTURE),
    });
    const referenceRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'beech-forest.jpg' })
      .first();
    await expect(referenceRow).toBeVisible({ timeout: 30000 });
    await referenceRow.click();
    await page.keyboard.press('Shift+2');

    const referenceSwitch = page.getByRole('switch', { name: 'Use as concept reference' });
    await expect(referenceSwitch).toBeVisible({ timeout: 15000 });
    const beforeMark = await contentHash(page);
    expect(await coloredPixels(page)).toBeGreaterThan(100);
    await referenceSwitch.check();
    await expect(
      page.locator('.concept-reference-options').getByText('beech-forest.jpg', { exact: true }),
    ).toBeVisible();
    const afterMark = await contentHash(page);
    expect(afterMark, 'marking an image as a reference must not hide its canvas pixels').toBe(
      beforeMark,
    );

    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Undo/ })
      .click();
    // History restores document state but clears the active layer selection;
    // select the reference again before reading its selection-scoped control.
    await referenceRow.click();
    await expect(referenceSwitch).not.toBeChecked();
    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Redo/ })
      .click();
    await referenceRow.click();
    await expect(referenceSwitch).toBeChecked();

    const samplingSwitch = page.getByRole('switch', { name: 'Include in artwork sampling' });
    const exportSwitch = page.getByRole('switch', { name: 'Include in artwork exports' });
    await expect(samplingSwitch).not.toBeChecked();
    await expect(exportSwitch).not.toBeChecked();

    await page.keyboard.press('Shift+W');
    await expect(page.getByTestId('magicwand-options')).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'Sample source' })
      .getByText('Visible artwork', { exact: true })
      .click();
    // The options popover covers part of the canvas. Close it before sending
    // the Magic Wand pointer gesture so the click reaches the artwork.
    await closeMagicWandOptions(page);
    const point = await referencePoint(page);
    const announcer = page.locator('#strata-canvas-announcer-polite');
    await expect(page.getByTestId('magicwand-options')).toBeHidden();
    await page.mouse.click(point.x, point.y);
    await expect(announcer).toContainText('No visible artwork is available to sample', {
      timeout: 15000,
    });

    await samplingSwitch.check();
    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Undo/ })
      .click();
    await expect(samplingSwitch).not.toBeChecked();
    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Redo/ })
      .click();
    await expect(samplingSwitch).toBeChecked();

    await expect(page.getByTestId('magicwand-options')).toBeHidden();
    await page.mouse.click(point.x, point.y);
    await expect(announcer).toContainText(/visible-artwork Magic Wand selection created/i, {
      timeout: 20000,
    });
    await expect.poll(() => coloredPixels(page)).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath('concept-reference-sampling-enabled.png') });

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    await expect(page.locator('.spec-export__message')).toContainText(
      /Export failed: .*excluded from artwork exports.*Include in artwork exports/,
    );

    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    await exportSwitch.scrollIntoViewIfNeeded();
    await exportSwitch.check();
    await expect(exportSwitch).toBeChecked();
    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const exportDownload = await exportDownloadPromise;
    const referenceExportPath = info.outputPath('concept-reference-included.png');
    await exportDownload.saveAs(referenceExportPath);
    const { readFile } = await import('node:fs/promises');
    const exportedReference = await readFile(referenceExportPath);
    const exportedPng = PNG.sync.read(exportedReference);
    expect(exportedPng.width).toBe(1280);
    expect(exportedPng.height).toBe(853);
    expect(countReferenceColor(exportedReference)).toBeGreaterThan(100);
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    await exportSwitch.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme;
      }, theme);
      await captureProducerScreenshot(page, info, `concept-reference-${theme}.png`);
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: info.outputPath('concept-reference-narrow.png') });
    await page.setViewportSize(VIEWPORT);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await selectExportTab(page);

    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await canvas.waitFor({ state: 'visible', timeout: 60000 });
    await page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'beech-forest.jpg' })
      .click();
    const reopenedReferenceSwitch = page.getByRole('switch', {
      name: 'Use as concept reference',
    });
    await expect(reopenedReferenceSwitch).toBeChecked();
    await expect(
      page.locator('.concept-reference-options').getByText('beech-forest.jpg', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Include in artwork sampling' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Include in artwork exports' })).toBeChecked();
    await expect.poll(() => coloredPixels(page)).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath('concept-reference-reopened.png') });
  });

  test('builds thumbnail variants around a reference, paints over a perspective block-in, and exports a sheet', async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    test.setTimeout(420000);
    await page.addInitScript(() => localStorage.setItem('varve.renderWorker', 'off'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/?isoTest=1&perf=1');

    // Three editable frame thumbnails share one Design canvas. Ctrl+D creates
    // two real variants; their frame positions are then set through Inspector.
    const frameTool = page.locator('.floating-toolbar [data-tool="frame"]');
    await frameTool.click();
    await expect(frameTool).toHaveAttribute('aria-pressed', 'true');
    await dragOnCanvas(page, 150, 150, 500, 450);
    const frames = page.locator('[role="treeitem"][data-layer-type="frame"]');
    await expect(frames).toHaveCount(1);
    await frames.first().click();
    const xField = page.getByRole('spinbutton', { name: 'X (px)' });
    const yField = page.getByRole('spinbutton', { name: 'Y (px)' });
    await xField.fill('40');
    await xField.press('Enter');
    await yField.fill('60');
    await yField.press('Enter');
    await xField.evaluate((element) => (element as HTMLElement).blur());
    const rectTool = page.locator('.floating-toolbar [data-tool="rect"]');
    await rectTool.click();
    await drawConceptRect(page, 78, 92, 250, 220, 'rect');
    await page.locator('.floating-toolbar [data-tool="select"]').click();
    await page.keyboard.press('Control+d');
    await expect(frames).toHaveCount(2);
    await xField.fill('340');
    await xField.press('Enter');
    await xField.evaluate((element) => (element as HTMLElement).blur());
    await page.keyboard.press('Control+d');
    await expect(frames).toHaveCount(3);
    await xField.fill('640');
    await xField.press('Enter');
    await xField.evaluate((element) => (element as HTMLElement).blur());
    await drawConceptRect(page, 690, 95, 785, 165, 'rect');
    await page.locator('.floating-toolbar [data-tool="select"]').click();
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    // The third thumbnail contains the block-in rectangle; the two-point guide
    // overlay itself is covered by the dedicated perspective-guide E2E.
    await page.screenshot({ path: info.outputPath('concept-art-perspective-block-in.png') });

    // A local photo stays visible as a reference while the two artwork
    // permissions remain independent and disabled by default.
    await page.locator('#file-import-input').setInputFiles({
      name: 'beech-forest.jpg',
      mimeType: 'image/jpeg',
      buffer: readFileSync(REFERENCE_FIXTURE),
    });
    const referenceRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'beech-forest.jpg' })
      .first();
    await expect(referenceRow).toBeVisible({ timeout: 30000 });
    await referenceRow.click();
    await page.keyboard.press('Shift+2');
    const referenceSwitch = page.getByRole('switch', { name: 'Use as concept reference' });
    await expect(referenceSwitch).toBeVisible();
    await referenceSwitch.check();
    await expect(
      page.getByRole('switch', { name: 'Include in artwork sampling' }),
    ).not.toBeChecked();
    const referenceExportSwitch = page.getByRole('switch', {
      name: 'Include in artwork exports',
    });
    await expect(referenceExportSwitch).not.toBeChecked();
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    const referenceX = page.getByRole('spinbutton', { name: 'X (px)' });
    await referenceX.fill('940');
    await referenceX.press('Enter');
    await referenceX.evaluate((element) => (element as HTMLElement).blur());
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.screenshot({ path: info.outputPath('concept-art-thumbnails-with-reference.png') });

    // Recover explicitly from a selected frame into a paint layer, then add a
    // warm paintover to the third variant with a real browser pointer stroke.
    await selectConceptFrameAtX(page, 640);
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
    const optionsTrigger = page.getByRole('button', { name: 'Tool options' });
    if ((await optionsTrigger.getAttribute('aria-expanded')) !== 'true')
      await optionsTrigger.click();
    const options = page.locator('.tool-options__popover');
    const brushBrowser = options.locator('.brush-browser');
    await brushBrowser.getByText('Paint', { exact: true }).click();
    await brushBrowser.getByRole('button', { name: 'Opaque Paint', exact: true }).click();
    await page.getByLabel('Foreground color').fill('#ff8c20');
    await options.getByLabel('Size').fill('18');
    await options.getByLabel('Size').press('Enter');
    const recovery = options.getByRole('button', { name: 'Create paint layer' });
    await expect(recovery).toBeVisible();
    await recovery.click();
    const paintLayer = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'Paint Layer' })
      .first();
    await expect(paintLayer).toHaveAttribute('aria-selected', 'true');
    await optionsTrigger.click();
    const orangePixelsBeforePaintover = await orangePaintPixels(page);
    const beforePaintover = await contentHash(page);
    const paintStart = await conceptScreenPoint(page, 660, 215);
    const paintEnd = await conceptScreenPoint(page, 800, 230);
    await page.mouse.move(paintStart.x, paintStart.y);
    await page.mouse.down();
    await page.mouse.move(paintEnd.x, paintEnd.y, { steps: 7 });
    await page.mouse.up();
    await expect.poll(() => contentHash(page)).not.toBe(beforePaintover);
    await expect
      .poll(() => orangePaintPixels(page))
      .toBeGreaterThan(orangePixelsBeforePaintover + 10);
    await page.keyboard.press('Control+z');
    await expect
      .poll(() => orangePaintPixels(page))
      .toBeLessThanOrEqual(orangePixelsBeforePaintover + 1);
    await expectSurfaceMatchesFullRedraw(page, 'undo');
    await expect
      .poll(() => orangePaintPixels(page))
      .toBeLessThanOrEqual(orangePixelsBeforePaintover + 1);
    await page.keyboard.press('Control+Shift+z');
    await expectSurfaceMatchesFullRedraw(page, 'redo');
    await expect
      .poll(() => orangePaintPixels(page))
      .toBeGreaterThan(orangePixelsBeforePaintover + 10);
    await page.screenshot({ path: info.outputPath('concept-art-variants-paintover.png') });

    // Compose only the three thumbnails and paintover into a presentation
    // sheet. The local reference remains outside the group and excluded from
    // sampling/export by default.
    await frames.first().click();
    for (let index = 1; index < (await frames.count()); index += 1) {
      await frames.nth(index).click({ modifiers: ['Control'] });
    }
    await paintLayer.click({ modifiers: ['Control'] });
    await page.getByRole('tree', { name: /layers/i }).press('Control+g');
    const presentationSheet = page.locator('[role="treeitem"][aria-selected="true"]');
    await expect(presentationSheet).toContainText(/Group/);
    await expect(presentationSheet).not.toContainText('beech-forest.jpg');
    await expect(page.locator('.editor-canvas')).toBeVisible();
    await selectExportTab(page);
    const pngGroup = page.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    const pngFormat = pngGroup.getByRole('radio', { name: 'PNG', exact: true });
    await pngFormat.check();
    await expect(pngFormat).toBeChecked();
    const sheetDownloadPromise = page.waitForEvent('download', { timeout: 120000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const sheetDownload = await sheetDownloadPromise;
    const sheetPath = info.outputPath('concept-art-presentation-sheet.png');
    await sheetDownload.saveAs(sheetPath);
    const { readFile } = await import('node:fs/promises');
    const sheetBytes = await readFile(sheetPath);
    const sheet = PNG.sync.read(sheetBytes);
    let sheetOrangePixels = 0;
    for (let offset = 0; offset < sheet.data.length; offset += 4) {
      if (
        (sheet.data[offset + 3] ?? 0) > 128 &&
        (sheet.data[offset] ?? 0) > 180 &&
        (sheet.data[offset + 1] ?? 0) > 60 &&
        (sheet.data[offset + 1] ?? 255) < 190 &&
        (sheet.data[offset + 2] ?? 255) < 80
      ) {
        sheetOrangePixels += 1;
      }
    }
    expect(sheetOrangePixels).toBeGreaterThan(10);
    expect(sheet.data[sheet.width * 4 + 3]).toBe(0);
    await page.screenshot({ path: info.outputPath('concept-art-sheet-export-ui.png') });

    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await page
      .locator('canvas.editor-canvas__content-layer')
      .waitFor({ state: 'visible', timeout: 60000 });
    await expect(page.locator('[role="treeitem"][data-layer-type="frame"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await expect.poll(() => orangePaintPixels(page)).toBeGreaterThan(10);
    await page.screenshot({ path: info.outputPath('concept-art-sheet-reopened.png') });
    for (const theme of ['dark', 'high-contrast'] as const) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await page.screenshot({ path: info.outputPath(`concept-art-sheet-${theme}.png`) });
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: info.outputPath('concept-art-sheet-narrow.png') });
    const reopenedReferenceRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'beech-forest.jpg' })
      .first();
    await reopenedReferenceRow.click();
    await page.keyboard.press('Shift+2');
    await expect(page.getByRole('switch', { name: 'Use as concept reference' })).toBeChecked();
    await expect(
      page.getByRole('switch', { name: 'Include in artwork sampling' }),
    ).not.toBeChecked();
    await expect(
      page.getByRole('switch', { name: 'Include in artwork exports' }),
    ).not.toBeChecked();
  });
});
