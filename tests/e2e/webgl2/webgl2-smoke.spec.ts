import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const requireFromEngine = createRequire(
  path.join(process.cwd(), 'packages', 'engine', 'package.json'),
);
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

async function contentFingerprint(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Content canvas is missing');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Content canvas does not expose a 2D context');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const pixel of pixels) hash = Math.imul(hash ^ pixel, 16777619);
    return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
  });
}

async function downloadAsset(page: Page, testInfo: TestInfo, format: 'PNG' | 'PDF', name: string) {
  const inspectorTabs = page.getByRole('tablist', { name: 'Inspector tabs' });
  const exportTab = inspectorTabs.getByRole('tab', { name: 'Export', exact: true });
  if (await exportTab.isVisible().catch(() => false)) {
    await exportTab.click();
  } else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
  await page.getByRole('tablist', { name: 'Export options' }).waitFor({ state: 'visible' });
  await page.getByRole('radio', { name: format, exact: true }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /download/i }).click();
  const download = await downloadPromise;
  const outputPath = testInfo.outputPath(name);
  await download.saveAs(outputPath);
  return readFileSync(outputPath);
}

async function forceAuthoritativeFrame(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const perf = (
      window as unknown as {
        __varvePerf?: { forceFullRedraw?: () => Promise<{ authoritative: boolean }> };
      }
    ).__varvePerf;
    if (!perf?.forceFullRedraw) throw new Error('The full-redraw oracle is unavailable');
    return perf.forceFullRedraw();
  });
  expect(result.authoritative).toBe(true);
}

async function expectWebGl2RecoverySettled(status: Locator): Promise<void> {
  // Recovery immediately schedules an authoritative redraw. Depending on
  // frame timing, the diagnostic can be sampled before or after that draw.
  await expect(status).toHaveText(/^WebGL2 (?:ready )?· experimental$/, { timeout: 30000 });
  if ((await status.textContent()) === 'WebGL2 ready · experimental') {
    await expect(status).toHaveAttribute('title', /last frame did not report eligible drawing/);
  } else {
    await expect(status).toHaveAttribute('title', /[1-9]\d* eligible item\(s\) were submitted/);
  }
}

type FixturePosition = { x: number; y: number };

async function positionFixtureAtDeviceEdges(
  page: Page,
  deviceOffset = 0,
  fixturePosition?: FixturePosition,
): Promise<FixturePosition> {
  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  const x =
    fixturePosition?.x ??
    Number(await inspector.getByLabel('X (px)', { exact: true }).inputValue());
  const y =
    fixturePosition?.y ??
    Number(await inspector.getByLabel('Y (px)', { exact: true }).inputValue());
  expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  const expected = await page.evaluate(
    ({ x, y, deviceOffset }) => {
      const perf = (
        window as unknown as {
          __varvePerf?: {
            getLast: () => {
              camera?: { zoom: number; panX: number; panY: number; rotation: number };
            };
            camera: {
              setState: (state: {
                zoom: number;
                pan: { x: number; y: number };
                rotation: number;
              }) => boolean;
            };
          };
        }
      ).__varvePerf;
      const camera = perf?.getLast().camera;
      if (!perf || !camera || camera.zoom !== 1 || camera.rotation !== 0) {
        throw new Error('This axis-aligned fixture requires the initial 100% camera');
      }
      const dpr = window.devicePixelRatio;
      const pan = {
        x: (Math.round((x + camera.panX) * dpr) + deviceOffset) / dpr - x,
        y: (Math.round((y + camera.panY) * dpr) + deviceOffset) / dpr - y,
      };
      if (!perf.camera.setState({ zoom: 1, pan, rotation: 0 })) {
        throw new Error('The production camera controller is unavailable');
      }
      return { zoom: 1, panX: pan.x, panY: pan.y, rotation: 0 };
    },
    { x, y, deviceOffset },
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __varvePerf: { getLast: () => { camera: unknown } } }
          ).__varvePerf.getLast().camera,
      ),
    )
    .toEqual(expected);
  return { x, y };
}

async function expectSurfaceMatchesAuthoritativeFrame(page: Page, label: string): Promise<void> {
  const before = await contentFingerprint(page);
  await forceAuthoritativeFrame(page);
  expect(await contentFingerprint(page)).toBe(before);
  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  const geometry = await inspector
    .locator('input[aria-label]')
    .evaluateAll((inputs) =>
      Object.fromEntries(
        inputs.map((input) => [
          input.getAttribute('aria-label'),
          (input as HTMLInputElement).value,
        ]),
      ),
    );
  const frames = await page.evaluate(() => {
    const perf = (
      window as unknown as { __varvePerf?: { getFrames?: (count: number) => unknown[] } }
    ).__varvePerf;
    return perf?.getFrames?.(20) ?? [];
  });
  const evidence = test.info().outputPath(`webgl2-fixture-${label}.json`);
  writeFileSync(evidence, `${JSON.stringify({ geometry, frames }, null, 2)}\n`);
  await test.info().attach(`WebGL2 fixture ${label}`, { path: evidence });
}

test('WebGL2 preference renders an edited document and agrees with the full-redraw oracle', async ({
  page,
}) => {
  test.setTimeout(300000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /webgl|shader|context/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}');
    } catch {
      current = {};
    }
    const render = (current.render as Record<string, unknown> | undefined) ?? {};
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ ...current, render: { ...render, renderer: 'webgl2' } }),
    );

    const prototype = HTMLCanvasElement.prototype as unknown as {
      getContext: (
        this: HTMLCanvasElement,
        type: string,
        options?: unknown,
      ) => RenderingContext | null;
    };
    const originalGetContext = prototype.getContext;
    prototype.getContext = function (type, options) {
      const context = originalGetContext.call(this, type, options);
      if (type === 'webgl2' && context) {
        const lossExtension = (context as WebGL2RenderingContext).getExtension(
          'WEBGL_lose_context',
        );
        (
          window as unknown as { __webgl2TestControls?: { lose: () => void; restore: () => void } }
        ).__webgl2TestControls = {
          lose: () => lossExtension?.loseContext(),
          restore: () => lossExtension?.restoreContext(),
        };
      }
      return context;
    };
  });
  await navigateToEditor(page, '/?perf=1');

  await page.keyboard.press('r');
  await dragOnCanvas(page, 170, 160, 390, 310);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
  await page.waitForTimeout(300);

  const status = page
    .locator('.editor-status__diagnostic, .editor-status__meta--warning')
    .filter({ hasText: /WebGL2/ });
  await expect(status).toBeVisible({ timeout: 30000 });
  const rendererStatus = await status.textContent();
  if (rendererStatus?.startsWith('WebGL2 unavailable')) {
    // WebGL2 is optional; a failed shader/presentation probe must leave a
    // working Canvas2D editor and disclose why the request was declined.
    await expect(status).toHaveAttribute('title', /WebGL2 preference fell back to Canvas2D/);
    expect(consoleErrors).toEqual([]);
    return;
  }
  // Fractional device edges deliberately use the authoritative Canvas2D
  // rasterizer. Selection chrome can also shift the camera by half a pixel;
  // make both fallback and eligible execution deterministic through the real
  // camera controller instead of assuming an old canvas layout.
  const fixturePosition = await positionFixtureAtDeviceEdges(page, 0.5);
  await expectSurfaceMatchesAuthoritativeFrame(page, 'fractional-fallback');
  await expect(status).toHaveText('WebGL2 ready · experimental');
  await expect(status).toHaveAttribute('title', /last frame did not report eligible drawing/);
  await positionFixtureAtDeviceEdges(page);
  await expectSurfaceMatchesAuthoritativeFrame(page, 'device-aligned');
  await expect(status).toHaveText('WebGL2 · experimental');
  await expect(status).toHaveAttribute('title', /[1-9]\d* eligible item\(s\) were submitted/);
  await page.screenshot({ path: test.info().outputPath('webgl2-edited-document.png') });

  const beforeOracle = await contentFingerprint(page);
  const oracle = await page.evaluate(async () => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean; renderPath: string }>;
        };
      }
    ).__varvePerf;
    if (!perf?.forceFullRedraw) throw new Error('The full-redraw oracle is unavailable');
    return perf.forceFullRedraw();
  });
  const afterOracle = await contentFingerprint(page);
  expect(oracle.authoritative).toBe(true);
  expect(beforeOracle).toBe(afterOracle);
  expect(consoleErrors).toEqual([]);

  // GPU presentation is a view of the authoritative document state: history
  // must remove and restore the same scene before a fresh accelerated frame
  // is presented.
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem')).toHaveCount(0, { timeout: 15000 });
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
  // Undo/redo restores the scene but may clear the Inspector selection. Reuse
  // the fixture's captured document coordinates for camera-only recovery so
  // the test does not create an unrelated selection redraw before context loss.
  await page.waitForTimeout(300);
  const beforeHistoryOracle = await contentFingerprint(page);
  const historyOracle = await page.evaluate(async () => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean; renderPath: string }>;
        };
      }
    ).__varvePerf;
    if (!perf?.forceFullRedraw) throw new Error('The full-redraw oracle is unavailable');
    return perf.forceFullRedraw();
  });
  expect(historyOracle.authoritative).toBe(true);
  expect(beforeHistoryOracle).toBe(await contentFingerprint(page));

  const lossWasTriggered = await page.evaluate(() => {
    const controls = (
      window as unknown as {
        __webgl2TestControls?: { lose: () => void; restore: () => void };
      }
    ).__webgl2TestControls;
    controls?.lose();
    return Boolean(controls);
  });
  expect(lossWasTriggered).toBe(true);
  await expect(status).toHaveText('WebGL2 lost · Canvas2D', { timeout: 15000 });
  await page.evaluate(() => {
    (
      window as unknown as {
        __webgl2TestControls?: { restore: () => void };
      }
    ).__webgl2TestControls?.restore();
  });
  await expectWebGl2RecoverySettled(status);
  await positionFixtureAtDeviceEdges(page, 1, fixturePosition);
  await expect(status).toHaveText('WebGL2 · experimental');
  await expect(status).toHaveAttribute('title', /[1-9]\d* eligible item\(s\) were submitted/);
  const beforeRecoveredOracle = await contentFingerprint(page);
  const recoveredOracle = await page.evaluate(async () => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean; renderPath: string }>;
        };
      }
    ).__varvePerf;
    if (!perf?.forceFullRedraw) throw new Error('The full-redraw oracle is unavailable');
    return perf.forceFullRedraw();
  });
  expect(recoveredOracle.authoritative).toBe(true);
  expect(beforeRecoveredOracle).toBe(await contentFingerprint(page));

  // One recovery has already succeeded. The second is the final permitted
  // attempt; a third context loss must remain on Canvas2D.
  await page.evaluate(() => {
    (
      window as unknown as { __webgl2TestControls?: { lose: () => void } }
    ).__webgl2TestControls?.lose();
  });
  await expect(status).toHaveText('WebGL2 lost · Canvas2D', { timeout: 15000 });
  await page.evaluate(() => {
    (
      window as unknown as { __webgl2TestControls?: { restore: () => void } }
    ).__webgl2TestControls?.restore();
  });
  await expectWebGl2RecoverySettled(status);
  await positionFixtureAtDeviceEdges(page, 2, fixturePosition);
  await expect(status).toHaveText('WebGL2 · experimental');
  await expect(status).toHaveAttribute('title', /[1-9]\d* eligible item\(s\) were submitted/);
  await page.evaluate(() => {
    (
      window as unknown as { __webgl2TestControls?: { lose: () => void } }
    ).__webgl2TestControls?.lose();
  });
  await expect(status).toHaveText('WebGL2 lost · Canvas2D', { timeout: 15000 });
  await page.evaluate(() => {
    (
      window as unknown as { __webgl2TestControls?: { restore: () => void } }
    ).__webgl2TestControls?.restore();
  });
  await page.waitForTimeout(500);
  await expect(status).toHaveText('WebGL2 lost · Canvas2D');
});

test('WebGL2 document saves, reopens, and exports the same PNG/PDF as Canvas2D', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  await page.addInitScript(() => {
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}');
    } catch {
      settings = {};
    }
    const render = (settings.render as Record<string, unknown> | undefined) ?? {};
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ ...settings, render: { ...render, renderer: 'webgl2' } }),
    );
  });
  await navigateToEditor(page, '/?perf=1');
  await page.keyboard.press('r');
  await dragOnCanvas(page, 170, 160, 390, 310);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

  const rendererStatus = page
    .locator('.editor-status__diagnostic, .editor-status__meta--warning')
    .filter({ hasText: /WebGL2/ });
  await expect(rendererStatus).toBeVisible({ timeout: 30000 });
  if ((await rendererStatus.textContent())?.startsWith('WebGL2 unavailable')) {
    test.skip(
      true,
      'WebGL2 is unavailable in this browser; the fallback test covers this configuration',
    );
  }
  await forceAuthoritativeFrame(page);
  await positionFixtureAtDeviceEdges(page);
  await expectSurfaceMatchesAuthoritativeFrame(page, 'device-aligned');
  await expect(rendererStatus).toHaveText('WebGL2 · experimental');

  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  const webglPngBytes = await downloadAsset(page, testInfo, 'PNG', 'webgl2-export.png');
  const webglPdfBytes = await downloadAsset(page, testInfo, 'PDF', 'webgl2-export.pdf');
  expect(webglPngBytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(webglPdfBytes.subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(webglPdfBytes.length).toBeGreaterThan(500);
  const webglPdfHeader = webglPdfBytes.toString('latin1', 0, webglPdfBytes.indexOf('stream'));
  const webglPageSize = webglPdfHeader.match(/\/MediaBox \[ 0 0 (\d+) (\d+) \]/);
  expect(webglPageSize, 'WebGL2 PDF has a non-empty page').not.toBeNull();
  expect(Number(webglPageSize?.[1])).toBeGreaterThan(0);
  expect(Number(webglPageSize?.[2])).toBeGreaterThan(0);
  const webglPng = PNG.sync.read(webglPngBytes);
  expect(webglPng.width).toBeGreaterThan(0);
  expect(webglPng.height).toBeGreaterThan(0);

  await page.evaluate(() => {
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}');
    } catch {
      settings = {};
    }
    const render = (settings.render as Record<string, unknown> | undefined) ?? {};
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ ...settings, render: { ...render, renderer: 'canvas2d' } }),
    );
  });
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 45000 });
  await page.locator('[role="gridcell"]').first().dblclick({ timeout: 30000 });
  await page.locator('canvas.editor-canvas__content-layer').waitFor({
    state: 'visible',
    timeout: 60000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
  // The selection export controls are intentionally absent until an object is
  // selected after reopening the saved document.
  await page.getByRole('treeitem').click();
  await forceAuthoritativeFrame(page);

  const canvasPngBytes = await downloadAsset(page, testInfo, 'PNG', 'canvas2d-export.png');
  const canvasPdfBytes = await downloadAsset(page, testInfo, 'PDF', 'canvas2d-export.pdf');
  const canvasPng = PNG.sync.read(canvasPngBytes);
  expect({ width: canvasPng.width, height: canvasPng.height }).toEqual({
    width: webglPng.width,
    height: webglPng.height,
  });
  expect(Buffer.compare(canvasPng.data, webglPng.data)).toBe(0);
  expect(canvasPdfBytes.subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(Buffer.compare(canvasPdfBytes, webglPdfBytes)).toBe(0);
});

test('WebGL2 keeps an interleaved Canvas2D fallback in paint order', async ({ page }) => {
  await page.goto('/');
  const compositorModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;
  const result = await page.evaluate(async (moduleUrl) => {
    const gpuCanvas = document.createElement('canvas');
    const cpuCanvas = document.createElement('canvas');
    gpuCanvas.width = cpuCanvas.width = 128;
    gpuCanvas.height = cpuCanvas.height = 128;
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    const mod = (await import(/* @vite-ignore */ moduleUrl)) as typeof import('@varve/compositor');
    const frame = {
      items: [],
      camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
      viewport: { width: 128, height: 128 },
      docVersion: 1,
    };
    const items = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 12, y: 12, w: 104, h: 104 },
        fill: { space: 'rgb', r: 240, g: 32, b: 24, a: 255 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'line', from: [12, 64], to: [116, 64], tolerance: 12 },
        fill: { space: 'rgb', r: 8, g: 12, b: 16, a: 255 },
      },
      {
        transform: [1, 0.25, 0.35, 1, 5, 5],
        primitive: { kind: 'ellipse', cx: 40, cy: 50, rx: 20, ry: 25 },
        fill: { space: 'rgb', r: 24, g: 232, b: 64, a: 255 },
        opacity: 0.5,
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 84, y: 56, w: 24, h: 24 },
        fill: { space: 'rgb', r: 32, g: 72, b: 240, a: 255 },
      },
    ];
    const gpu = new mod.WebGL2Backend();
    const cpu = new mod.Canvas2DBackend();
    await gpu.init(gpuCanvas);
    await cpu.init(cpuCanvas);
    gpu.beginFrame(frame);
    gpu.drawVectorItems(items as never[]);
    gpu.endFrame();
    cpu.beginFrame(frame);
    cpu.drawVectorItems(items as never[]);
    cpu.endFrame();
    const gpuContext = gpuCanvas.getContext('2d');
    const cpuContext = cpuCanvas.getContext('2d');
    if (!gpuContext || !cpuContext) throw new Error('Canvas2D presentation context unavailable');
    const worldPoints = [
      { x: 28, y: 28, label: 'supported shape before fallback' },
      { x: 62.5, y: 65, label: 'skewed transparent shape after fallback' },
      { x: 75, y: 64, label: 'fallback stroke before later GPU shape' },
      { x: 90, y: 64, label: 'supported shape after fallback' },
    ];
    const screenPoint = (x: number, y: number, dpr: number) => {
      const centerX = frame.viewport.width / 2;
      const centerY = frame.viewport.height / 2;
      const dx = x * frame.camera.zoom - centerX;
      const dy = y * frame.camera.zoom - centerY;
      const cos = Math.cos(frame.camera.rotation);
      const sin = Math.sin(frame.camera.rotation);
      return {
        x: Math.round((centerX + frame.camera.pan.x + dx * cos - dy * sin) * dpr),
        y: Math.round((centerY + frame.camera.pan.y + dx * sin + dy * cos) * dpr),
      };
    };
    const sample = (dpr: number) =>
      worldPoints.map(({ x, y, label }) => {
        const pixel = screenPoint(x, y, dpr);
        return {
          label: `${label} at ${dpr}x DPR`,
          gpu: Array.from(gpuContext.getImageData(pixel.x, pixel.y, 1, 1).data),
          cpu: Array.from(cpuContext.getImageData(pixel.x, pixel.y, 1, 1).data),
        };
      });
    const samples = sample(1);
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    gpuCanvas.width = cpuCanvas.width = 256;
    gpuCanvas.height = cpuCanvas.height = 256;
    gpu.beginFrame(frame);
    gpu.drawVectorItems(items as never[]);
    gpu.endFrame();
    cpu.beginFrame(frame);
    cpu.drawVectorItems(items as never[]);
    cpu.endFrame();
    samples.push(...sample(2));
    const diagnostics = gpu.getDiagnostics();
    gpu.destroy();
    cpu.destroy();
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: originalDpr,
    });
    return { samples, gpuActive: diagnostics.gpuActive, submitted: diagnostics.lastFrameGpuItems };
  }, compositorModuleUrl);

  for (const sample of result.samples) {
    expect(
      sample.gpu.every((channel, index) => Math.abs(channel - sample.cpu[index]!) <= 2),
      `${sample.label}: WebGL2 ${sample.gpu.join(',')} vs Canvas2D ${sample.cpu.join(',')}`,
    ).toBe(true);
  }
  if (result.gpuActive) expect(result.submitted).toBe(2);
});

test('WebGL2 matches a full Canvas2D reference outside the analytic one-pixel edge mask', async ({
  page,
}) => {
  await page.goto('/');
  const compositorModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;
  const result = await page.evaluate(async (moduleUrl) => {
    const gpuCanvas = document.createElement('canvas');
    const cpuCanvas = document.createElement('canvas');
    const originalDpr = window.devicePixelRatio;
    const mod = (await import(/* @vite-ignore */ moduleUrl)) as typeof import('@varve/compositor');
    const frame = {
      items: [],
      camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
      viewport: { width: 128, height: 128 },
      docVersion: 1,
    };
    const items = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 12, y: 12, w: 104, h: 104 },
        fill: { space: 'rgb', r: 240, g: 32, b: 24, a: 255 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'line', from: [12, 64], to: [116, 64], tolerance: 12 },
        fill: { space: 'rgb', r: 8, g: 12, b: 16, a: 255 },
      },
      {
        transform: [1, 0.25, 0.35, 1, 5, 5],
        primitive: { kind: 'ellipse', cx: 40, cy: 50, rx: 20, ry: 25 },
        fill: { space: 'rgb', r: 24, g: 232, b: 64, a: 255 },
        opacity: 0.5,
      },
    ];
    const gpu = new mod.WebGL2Backend();
    const cpu = new mod.Canvas2DBackend();
    await gpu.init(gpuCanvas);
    await cpu.init(cpuCanvas);
    const gpuContext = gpuCanvas.getContext('2d');
    const cpuContext = cpuCanvas.getContext('2d');
    if (!gpuContext || !cpuContext) throw new Error('Canvas2D presentation context unavailable');
    const transform = (item: (typeof items)[number], x: number, y: number) => {
      const [a, b, c, d, e, f] = item.transform;
      const worldX = a! * x + c! * y + e!;
      const worldY = b! * x + d! * y + f!;
      const centerX = frame.viewport.width / 2;
      const centerY = frame.viewport.height / 2;
      const dx = worldX * frame.camera.zoom - centerX;
      const dy = worldY * frame.camera.zoom - centerY;
      const cos = Math.cos(frame.camera.rotation);
      const sin = Math.sin(frame.camera.rotation);
      return {
        x: centerX + frame.camera.pan.x + dx * cos - dy * sin,
        y: centerY + frame.camera.pan.y + dx * sin + dy * cos,
      };
    };
    const rect = items[0]!.primitive as { x: number; y: number; w: number; h: number };
    const ellipse = items[2]!.primitive as { cx: number; cy: number; rx: number; ry: number };
    const outline = [
      [
        transform(items[0]!, rect.x, rect.y),
        transform(items[0]!, rect.x + rect.w, rect.y),
        transform(items[0]!, rect.x + rect.w, rect.y + rect.h),
        transform(items[0]!, rect.x, rect.y + rect.h),
      ],
      Array.from({ length: 512 }, (_, index) => {
        const angle = (index / 512) * Math.PI * 2;
        return transform(
          items[2]!,
          ellipse.cx + Math.cos(angle) * ellipse.rx,
          ellipse.cy + Math.sin(angle) * ellipse.ry,
        );
      }),
    ];
    const distanceToSegment = (
      point: { x: number; y: number },
      a: typeof point,
      b: typeof point,
    ) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    };
    const comparisons = [];
    for (const dpr of [1, 2]) {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
      gpuCanvas.width = cpuCanvas.width = 128 * dpr;
      gpuCanvas.height = cpuCanvas.height = 128 * dpr;
      gpu.beginFrame(frame);
      gpu.drawVectorItems(items as never[]);
      gpu.endFrame();
      cpu.beginFrame(frame);
      cpu.drawVectorItems(items as never[]);
      cpu.endFrame();
      const gpuPixels = gpuContext.getImageData(0, 0, gpuCanvas.width, gpuCanvas.height).data;
      const cpuPixels = cpuContext.getImageData(0, 0, cpuCanvas.width, cpuCanvas.height).data;
      const diff = document.createElement('canvas');
      const scale = 4;
      diff.width = gpuCanvas.width * scale;
      diff.height = gpuCanvas.height * scale;
      const diffContext = diff.getContext('2d');
      if (!diffContext) throw new Error('Could not create full-frame difference image');
      let interiorMismatchPixels = 0;
      let edgeMismatchPixels = 0;
      let interiorMaxChannelDelta = 0;
      let edgeMaxChannelDelta = 0;
      let worstEdgePixel: {
        x: number;
        y: number;
        maxDelta: number;
        gpu: number[];
        cpu: number[];
      } | null = null;
      for (let y = 0; y < gpuCanvas.height; y++) {
        for (let x = 0; x < gpuCanvas.width; x++) {
          const pixelIndex = (y * gpuCanvas.width + x) * 4;
          let maxDelta = 0;
          for (let channel = 0; channel < 4; channel++) {
            // Compare the color contribution that source-over compositing
            // presents. WebGL readback may retain arbitrary straight RGB in
            // almost-transparent edge pixels; Canvas2D commonly zeros it.
            const gpuValue =
              channel === 3
                ? gpuPixels[pixelIndex + channel]!
                : Math.round((gpuPixels[pixelIndex + channel]! * gpuPixels[pixelIndex + 3]!) / 255);
            const cpuValue =
              channel === 3
                ? cpuPixels[pixelIndex + channel]!
                : Math.round((cpuPixels[pixelIndex + channel]! * cpuPixels[pixelIndex + 3]!) / 255);
            maxDelta = Math.max(maxDelta, Math.abs(gpuValue - cpuValue));
          }
          const devicePoint = { x: x + 0.5, y: y + 0.5 };
          const nearAnalyticEdge = outline.some((polygon) => {
            for (let index = 0; index < polygon.length; index++) {
              const a = polygon[index]!;
              const b = polygon[(index + 1) % polygon.length]!;
              if (
                distanceToSegment(
                  devicePoint,
                  { x: a.x * dpr, y: a.y * dpr },
                  { x: b.x * dpr, y: b.y * dpr },
                ) <= 1
              )
                return true;
            }
            return false;
          });
          if (nearAnalyticEdge) {
            if (maxDelta > edgeMaxChannelDelta) {
              worstEdgePixel = {
                x,
                y,
                maxDelta,
                gpu: [...gpuPixels.slice(pixelIndex, pixelIndex + 4)],
                cpu: [...cpuPixels.slice(pixelIndex, pixelIndex + 4)],
              };
            }
            edgeMaxChannelDelta = Math.max(edgeMaxChannelDelta, maxDelta);
            if (maxDelta > 0) edgeMismatchPixels++;
            diffContext.fillStyle =
              maxDelta === 0
                ? '#000'
                : `rgb(${Math.min(255, maxDelta * 80)},${Math.min(255, maxDelta * 80)},0)`;
          } else {
            interiorMaxChannelDelta = Math.max(interiorMaxChannelDelta, maxDelta);
            if (maxDelta > 0) interiorMismatchPixels++;
            diffContext.fillStyle = maxDelta === 0 ? '#000' : '#ff0000';
          }
          diffContext.fillRect(x * scale, y * scale, scale, scale);
        }
      }
      diff.id = `webgl2-diff-${dpr}x`;
      diff.style.cssText =
        'display:block;width:min(768px,95vw);height:auto;margin:8px;border:1px solid #666';
      document.body.append(diff);
      comparisons.push({
        dpr,
        interiorMismatchPixels,
        edgeMismatchPixels,
        interiorMaxChannelDelta,
        edgeMaxChannelDelta,
        worstEdgePixel,
      });
    }
    const diagnostics = gpu.getDiagnostics();
    gpu.destroy();
    cpu.destroy();
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: originalDpr,
    });
    return {
      comparisons,
      gpuActive: diagnostics.gpuActive,
      submitted: diagnostics.lastFrameGpuItems,
    };
  }, compositorModuleUrl);

  test.skip(!result.gpuActive, 'WebGL2 is unavailable; Canvas2D fallback is checked separately');
  for (const comparison of result.comparisons) {
    await page.locator(`#webgl2-diff-${comparison.dpr}x`).screenshot({
      path: test.info().outputPath(`webgl2-canvas2d-diff-${comparison.dpr}x.png`),
    });
    expect(comparison.interiorMismatchPixels, `${comparison.dpr}x exact interior pixels`).toBe(0);
    expect(comparison.interiorMaxChannelDelta, `${comparison.dpr}x interior channel delta`).toBe(0);
    expect(
      comparison.edgeMaxChannelDelta,
      `${comparison.dpr}x one-pixel analytic edge delta: ${JSON.stringify(comparison.worstEdgePixel)}`,
    ).toBeLessThanOrEqual(2);
  }
  expect(result.submitted).toBe(1);
});

test('WebGL2 image textures preserve orientation and replace cached sources', async ({ page }) => {
  await page.goto('/');
  const compositorModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;
  const engineModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/engine/src/index.ts')}`;
  const result = await page.evaluate(
    async ({ compositorUrl, engineUrl }) => {
      const mod = (await import(
        /* @vite-ignore */ compositorUrl
      )) as typeof import('@varve/compositor');
      const engine = (await import(/* @vite-ignore */ engineUrl)) as typeof import('@varve/engine');
      const gpuCanvas = document.createElement('canvas');
      const cpuCanvas = document.createElement('canvas');
      gpuCanvas.width = cpuCanvas.width = 128;
      gpuCanvas.height = cpuCanvas.height = 128;
      const source = 'webgl2-image-replacement-e2e';
      const imageCanvas = document.createElement('canvas');
      imageCanvas.width = imageCanvas.height = 2;
      const imageContext = imageCanvas.getContext('2d');
      if (!imageContext) throw new Error('Could not construct the image test pattern');
      imageContext.fillStyle = '#ef2020';
      imageContext.fillRect(0, 0, 1, 1);
      imageContext.fillStyle = '#20df30';
      imageContext.fillRect(1, 0, 1, 1);
      imageContext.fillStyle = '#2030ef';
      imageContext.fillRect(0, 1, 1, 1);
      imageContext.fillStyle = '#e0cf20';
      imageContext.fillRect(1, 1, 1, 1);
      const firstBitmap = await createImageBitmap(imageCanvas);
      engine.getImageCache().setLoaded(source, firstBitmap);
      const imageItem: import('@varve/engine').RenderItem = {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 10, y: 10, w: 2, h: 2 },
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
        fills: [
          {
            type: 'image',
            src: source,
            fit: 'stretch',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 2,
            imageHeight: 2,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
      };
      const frame: import('@varve/compositor').CompositorFrame = {
        items: [imageItem],
        camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
        viewport: { width: 128, height: 128 },
        docVersion: 1,
      };
      const gpu = new mod.WebGL2Backend();
      const cpu = new mod.Canvas2DBackend();
      await gpu.init(gpuCanvas);
      await cpu.init(cpuCanvas);
      const gpuContext = gpuCanvas.getContext('2d');
      const cpuContext = cpuCanvas.getContext('2d');
      if (!gpuContext || !cpuContext) throw new Error('Canvas2D presentation context unavailable');
      const points = [
        { x: 10, y: 10, label: 'top-left' },
        { x: 11, y: 10, label: 'top-right' },
        { x: 10, y: 11, label: 'bottom-left' },
        { x: 11, y: 11, label: 'bottom-right' },
      ];
      const draw = () => {
        gpu.beginFrame(frame);
        gpu.drawVectorItems([imageItem] as never[]);
        gpu.endFrame();
        cpu.beginFrame(frame);
        cpu.drawVectorItems([imageItem] as never[]);
        cpu.endFrame();
        return points.map(({ x, y, label }) => ({
          label,
          gpu: Array.from(gpuContext.getImageData(x, y, 1, 1).data),
          cpu: Array.from(cpuContext.getImageData(x, y, 1, 1).data),
        }));
      };
      const firstSamples = draw();
      const firstDiagnostics = gpu.getDiagnostics();
      const replacementCanvas = document.createElement('canvas');
      replacementCanvas.width = replacementCanvas.height = 2;
      const replacementContext = replacementCanvas.getContext('2d');
      if (!replacementContext) throw new Error('Could not construct replacement image');
      replacementContext.fillStyle = '#8020d0';
      replacementContext.fillRect(0, 0, 2, 2);
      const replacementBitmap = await createImageBitmap(replacementCanvas);
      engine.getImageCache().setLoaded(source, replacementBitmap);
      const replacementSamples = draw();
      const replacementDiagnostics = gpu.getDiagnostics();
      gpu.destroy();
      cpu.destroy();
      engine.resetImageCache();
      firstBitmap.close();
      replacementBitmap.close();
      return {
        firstSamples,
        replacementSamples,
        gpuActive: replacementDiagnostics.gpuActive,
        submitted: replacementDiagnostics.lastFrameGpuItems,
        firstTextureBytes: firstDiagnostics.gpuTextureBytes,
        replacementTextureBytes: replacementDiagnostics.gpuTextureBytes,
      };
    },
    { compositorUrl: compositorModuleUrl, engineUrl: engineModuleUrl },
  );

  for (const sample of [...result.firstSamples, ...result.replacementSamples]) {
    expect(
      sample.gpu.every((channel, index) => Math.abs(channel - sample.cpu[index]!) <= 8),
      `${sample.label}: WebGL2 ${sample.gpu.join(',')} vs Canvas2D ${sample.cpu.join(',')}`,
    ).toBe(true);
  }
  const sourceColors = [
    [239, 32, 32, 255],
    [32, 223, 48, 255],
    [32, 48, 239, 255],
    [224, 207, 32, 255],
  ];
  for (const [index, expected] of sourceColors.entries()) {
    const sample = result.firstSamples[index]!;
    expect(
      sample.cpu.every((channel, channelIndex) => Math.abs(channel - expected[channelIndex]!) <= 2),
      `${sample.label}: Canvas2D source orientation ${sample.cpu.join(',')}`,
    ).toBe(true);
    expect(
      sample.gpu.every((channel, channelIndex) => Math.abs(channel - expected[channelIndex]!) <= 8),
      `${sample.label}: WebGL2 source orientation ${sample.gpu.join(',')}`,
    ).toBe(true);
  }
  const replacementColor = [128, 32, 208, 255];
  for (const sample of result.replacementSamples) {
    expect(
      sample.gpu.every(
        (channel, channelIndex) => Math.abs(channel - replacementColor[channelIndex]!) <= 8,
      ),
      `${sample.label}: replacement image ${sample.gpu.join(',')}`,
    ).toBe(true);
  }
  if (result.gpuActive) {
    expect(result.submitted).toBe(1);
    expect(result.firstTextureBytes).toBe(16);
    expect(result.replacementTextureBytes).toBe(16);
    expect(result.firstSamples[0]!.gpu).not.toEqual(result.replacementSamples[0]!.gpu);
  }
});

test('an unavailable WebGL2 context reports and draws through Canvas2D fallback', async ({
  page,
}) => {
  await page.goto('/');
  const compositorModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;
  const result = await page.evaluate(async (moduleUrl) => {
    const prototype = HTMLCanvasElement.prototype as unknown as {
      getContext: (
        this: HTMLCanvasElement,
        type: string,
        options?: unknown,
      ) => RenderingContext | null;
    };
    const originalGetContext = prototype.getContext;
    prototype.getContext = function (type, options) {
      if (type === 'webgl2') return null;
      return originalGetContext.call(this, type, options);
    };
    try {
      const mod = (await import(
        /* @vite-ignore */ moduleUrl
      )) as typeof import('@varve/compositor');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const { backend, capabilities } = await mod.createCompositorBackend(canvas, {
        renderer: 'webgl2',
      });
      const frame = {
        items: [],
        camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
        viewport: { width: 64, height: 64 },
        docVersion: 1,
      };
      const item = {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 8, y: 8, w: 48, h: 48 },
        fill: { space: 'rgb', r: 240, g: 32, b: 24, a: 255 },
      };
      backend.beginFrame(frame);
      backend.drawVectorItems([item] as never[]);
      backend.endFrame();
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas2D fallback surface unavailable');
      const pixel = Array.from(context.getImageData(32, 32, 1, 1).data);
      backend.destroy();
      return {
        backendId: backend.id,
        webgl2: capabilities.webgl2,
        reason: capabilities.webgl2Reason,
        pixel,
      };
    } finally {
      prototype.getContext = originalGetContext;
    }
  }, compositorModuleUrl);
  expect(result.backendId).toBe('canvas2d');
  expect(result.webgl2).toBe(false);
  expect(result.reason).toMatch(/WebGL2 context unavailable/);
  expect(result.pixel).toEqual([240, 32, 24, 255]);
});

test('a failed known-colour WebGL2 probe falls back to Canvas2D', async ({ page }) => {
  await page.goto('/');
  const compositorModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;
  const result = await page.evaluate(async (moduleUrl) => {
    const prototype = CanvasRenderingContext2D.prototype;
    const originalGetImageData = prototype.getImageData;
    prototype.getImageData = function (...args) {
      if (this.canvas.width === 8 && this.canvas.height === 8) return new ImageData(1, 1);
      return originalGetImageData.apply(this, args);
    };
    const mod = (await import(/* @vite-ignore */ moduleUrl)) as typeof import('@varve/compositor');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    let backend: import('@varve/compositor').CompositorBackend;
    let capabilities: import('@varve/compositor').CompositorCapabilities;
    try {
      ({ backend, capabilities } = await mod.createCompositorBackend(canvas, {
        renderer: 'webgl2',
      }));
    } finally {
      prototype.getImageData = originalGetImageData;
    }
    if (capabilities.webgl2Reason === 'WebGL2 context unavailable') {
      backend.destroy();
      return { available: false as const };
    }
    const frame: import('@varve/compositor').CompositorFrame = {
      items: [],
      camera: { zoom: 1, pan: { x: 0, y: 0 } },
      viewport: { width: 64, height: 64 },
      docVersion: 1,
    };
    backend.beginFrame(frame);
    backend.drawVectorItems([
      {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 8, y: 8, w: 48, h: 48 },
        fill: { space: 'rgb', r: 240, g: 32, b: 24, a: 255 },
      },
    ] as never[]);
    backend.endFrame();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas2D fallback surface unavailable');
    const pixel = Array.from(context.getImageData(32, 32, 1, 1).data);
    const result = {
      available: true as const,
      backendId: backend.id,
      webgl2: capabilities.webgl2,
      reason: capabilities.webgl2Reason,
      pixel,
    };
    backend.destroy();
    return result;
  }, compositorModuleUrl);
  if (!result.available) {
    test.skip(true, 'This browser has no WebGL2 context to exercise the probe');
    return;
  }
  expect(result.backendId).toBe('canvas2d');
  expect(result.webgl2).toBe(false);
  expect(result.reason).toMatch(/WebGL2 presentation probe failed/);
  expect(result.pixel).toEqual([240, 32, 24, 255]);
});
