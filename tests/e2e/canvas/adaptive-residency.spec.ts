import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function sampleCanvas(
  page: import('@playwright/test').Page,
  box: { x: number; y: number; w: number; h: number },
): Promise<number[]> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  return canvas.evaluate((element, area) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const scaleX = surface.width / surface.clientWidth;
    const scaleY = surface.height / surface.clientHeight;
    const points = [0.25, 0.5, 0.75].map((fraction) => ({
      x: area.x + area.w * fraction,
      y: area.y + area.h * 0.5,
    }));
    return points.map((point) => {
      const pixel = context.getImageData(
        Math.max(0, Math.min(surface.width - 1, Math.round(point.x * scaleX))),
        Math.max(0, Math.min(surface.height - 1, Math.round(point.y * scaleY))),
        1,
        1,
      ).data;
      return (
        Math.max(...Array.from(pixel).slice(0, 3)) - Math.min(...Array.from(pixel).slice(0, 3))
      );
    });
  }, box);
}

async function canvasHash(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 97) {
      hash ^= pixels[i] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  });
}

async function canvasPixelSample(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const sample: number[] = [];
    for (let i = 0; i < pixels.length; i += 97) sample.push(pixels[i] ?? 0);
    return sample;
  });
}

async function canvasSurfaceState(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    return {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      rect: canvas.getBoundingClientRect().toJSON(),
      dpr: window.devicePixelRatio,
      transform: context?.getTransform().toJSON(),
    };
  });
}

async function recentFrameSummary(page: import('@playwright/test').Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const perf = window as Window & {
      __varvePerf?: {
        getFrames?: (count: number) => Array<Record<string, unknown>>;
      };
    };
    return (perf.__varvePerf?.getFrames?.(6) ?? []).map(
      ({
        frameIndex,
        renderPath,
        actualDrawingPath,
        frameSource,
        frameDecision,
        partialRedraw,
        camera,
      }) => ({
        frameIndex,
        renderPath,
        actualDrawingPath,
        frameSource,
        frameDecision,
        partialRedraw,
        camera,
      }),
    );
  });
}

/** The forceFullRedraw oracle is only real when the perf handle is installed. */
async function expectPerfSeam(page: import('@playwright/test').Page): Promise<void> {
  const installed = await page.evaluate(() =>
    Boolean((window as Window & { __varvePerf?: unknown }).__varvePerf),
  );
  expect(installed, 'perf handle must be installed for the redraw oracle').toBe(true);
}

async function editorCamera(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('React root not found');
    const key = Object.keys(root).find((name) => name.startsWith('__reactContainer$'));
    if (!key) throw new Error('React container not found');
    function find(fiber: any): any {
      if (!fiber) return null;
      const value = fiber.memoizedProps?.value;
      if (value?.state && typeof value.setCamera === 'function') return value;
      return find(fiber.child) || find(fiber.sibling);
    }
    const editor = find((root as any)[key]);
    if (!editor) throw new Error('Editor context not found');
    return {
      zoom: editor.state.zoom,
      panX: editor.state.pan.x,
      panY: editor.state.pan.y,
      rotation: editor.state.cameraRotation,
    };
  });
}

async function waitForStableEditorCamera(page: import('@playwright/test').Page) {
  let previous = await editorCamera(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(50);
    const next = await editorCamera(page);
    if (
      next.zoom === previous.zoom &&
      next.panX === previous.panX &&
      next.panY === previous.panY &&
      next.rotation === previous.rotation
    ) {
      return next;
    }
    previous = next;
  }
  throw new Error(
    `camera did not settle before full-redraw comparison: ${JSON.stringify(previous)}`,
  );
}

test('selected-frame image import remains nested, clipped, and pixel-stable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await expectPerfSeam(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await page.keyboard.press('f');
  await dragOnCanvas(page, 150, 120, 550, 420);

  const frameRow = page.getByRole('treeitem').filter({ hasText: /frame/i }).first();
  await expect(frameRow).toBeVisible();
  await frameRow.click();
  await expect(frameRow).toHaveAttribute('aria-selected', 'true');
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));

  const imageRow = page
    .locator('[role="treeitem"][data-layer-type="image"]')
    .filter({ hasText: /photo-fixture|jpg/i })
    .first();
  await expect(imageRow).toHaveAttribute('aria-level', '2');
  await expect(page.getByRole('treeitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await page.waitForTimeout(600);
  await frameRow.click();

  const layout = page
    .getByRole('region', { name: 'Inspector' })
    .getByRole('button', { name: 'Stack / Grid', exact: true })
    .first();
  if ((await layout.getAttribute('aria-expanded')) !== 'true') await layout.click();
  await expect(page.getByRole('switch', { name: /^clip content$/i })).toBeChecked();

  const selection = page.locator('svg:has(filter#selection-glow) > rect').first();
  await expect(selection).toBeVisible();
  const bounds = await selection.evaluate((element) => {
    const rect = element as SVGRectElement;
    return {
      x: rect.x.baseVal.value + rect.width.baseVal.value * 0.1,
      y: rect.y.baseVal.value + rect.height.baseVal.value * 0.1,
      w: rect.width.baseVal.value * 0.8,
      h: rect.height.baseVal.value * 0.8,
    };
  });
  const samples = await sampleCanvas(page, bounds);
  expect(Math.max(...samples), 'nested image interior should contain image pixels').toBeGreaterThan(
    12,
  );
  expect(new Set(samples).size).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath('nested-image-clipped.png') });

  const beforeFullRedraw = await canvasHash(page);
  await page.evaluate(async () => {
    const perf = (window as Window & { __varvePerf?: { forceFullRedraw?: () => Promise<unknown> } })
      .__varvePerf;
    await perf?.forceFullRedraw?.();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await canvasHash(page), 'full redraw oracle should match the incremental frame').toBe(
    beforeFullRedraw,
  );

  await canvas.focus();
});

test('large imagery converges after rapid zoom without losing settled pixels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await expectPerfSeam(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/caf-4k.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await page.waitForTimeout(700);

  await canvas.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('+');
  for (let i = 0; i < 5; i++) await page.keyboard.press('-');
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await page.waitForTimeout(1200);
  const settledCamera = await waitForStableEditorCamera(page);

  const samples = await sampleCanvas(page, { x: 0, y: 0, w: 900, h: 600 });
  expect(
    Math.max(...samples),
    'large imagery should remain painted after zoom churn',
  ).toBeGreaterThan(12);
  const previousFrames = await recentFrameSummary(page);
  const surfaceBeforeOracle = await canvasSurfaceState(page);
  const settledHash = await canvasHash(page);
  const settledPixels = await canvasPixelSample(page);
  expect(
    await editorCamera(page),
    'camera must stay fixed while capturing the pre-oracle surface',
  ).toEqual(settledCamera);
  const oracle = await page.evaluate(async () => {
    const perf = (window as Window & { __varvePerf?: { forceFullRedraw?: () => Promise<unknown> } })
      .__varvePerf;
    return await perf?.forceFullRedraw?.();
  });
  expect(oracle).toMatchObject({ authoritative: true });
  expect(await editorCamera(page), 'oracle must redraw the exact captured camera').toEqual(
    settledCamera,
  );
  const redrawFrames = await recentFrameSummary(page);
  const surfaceAfterOracle = await canvasSurfaceState(page);
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const authoritativePixels = await canvasPixelSample(page);
  const differences = settledPixels.flatMap((value, index) =>
    value === authoritativePixels[index] ? [] : [[index, value, authoritativePixels[index]]],
  );
  expect(
    await canvasHash(page),
    `settled adaptive imagery must match an authoritative redraw; ${differences.length} sampled bytes differ: ${JSON.stringify(differences.slice(0, 16))}; oracle=${JSON.stringify(oracle)}; before=${JSON.stringify(previousFrames)}; after=${JSON.stringify(redrawFrames)}; surfaceBefore=${JSON.stringify(surfaceBeforeOracle)}; surfaceAfter=${JSON.stringify(surfaceAfterOracle)}`,
  ).toBe(settledHash);
});

test('drawing a frame around an existing image captures only that image', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await page.waitForTimeout(700);

  const imageSelection = page.locator('svg:has(filter#selection-glow) > rect').first();
  await expect(imageSelection).toBeVisible();
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const dimensions = page.getByRole('group', { name: 'Position & Size' });
  await dimensions.getByLabel('W (px)').fill('420');
  await dimensions.getByLabel('W (px)').press('Enter');
  await dimensions.getByLabel('H (px)').fill('300');
  await dimensions.getByLabel('H (px)').press('Enter');
  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await page.waitForTimeout(300);
  await canvas.focus();
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('-');
  await page.waitForTimeout(200);
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('content canvas not found after fit-all');
  const imageBounds = await imageSelection.evaluate(
    (element, origin) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x - origin.x,
        y: rect.y - origin.y,
        w: rect.width,
        h: rect.height,
        screenX: rect.x,
        screenY: rect.y,
      };
    },
    { x: canvasBox.x, y: canvasBox.y },
  );
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: 'Frame', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dragOnCanvas(
    page,
    imageBounds.x - 20,
    imageBounds.y - 20,
    imageBounds.x + imageBounds.w + 20,
    imageBounds.y + imageBounds.h + 20,
  );

  const imageRow = page
    .locator('[role="treeitem"][data-layer-type="image"]')
    .filter({ hasText: /photo-fixture|jpg/i })
    .first();
  await expect(imageRow).toHaveAttribute('aria-level', '2');
  await expect(page.locator('[role="treeitem"][data-layer-type="frame"]').first()).toBeVisible();
  await page.waitForTimeout(700);
  expect(
    Math.max(...(await sampleCanvas(page, imageBounds))),
    'captured image must remain painted inside its new frame',
  ).toBeGreaterThan(12);
});
