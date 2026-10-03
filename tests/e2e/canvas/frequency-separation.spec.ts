/**
 * Frequency Separation E2E — real canvas, real dialog, real render pipeline.
 *
 * The critical invariant is visual: before separation is applied the canvas
 * must show the source; after separation it must show the same pixels (the
 * decode is ±1 LSB / channel). Pixel comparison reads the real canvas buffer
 * in-page via `getImageData`; both samples must have the same camera and surface;
 * element screenshots are attached for human review only.
 *
 * Run with:
 *   npx playwright test tests/e2e/canvas/frequency-separation.spec.ts --project=chromium --reporter=list
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(360_000);

type PixelCamera = { zoom: number; panX: number; panY: number; rotation: number };
type PixelShot = { id: string; width: number; height: number; camera: PixelCamera };

declare global {
  interface Window {
    __varvePerf?: {
      fixtures: {
        apply: (id: string) => Promise<{ ok: boolean }>;
      };
      forceFullRedraw: () => void;
    };
    __frequencyProbe?: {
      capture: (id: string) => PixelShot | null;
      diff: (
        firstId: string,
        secondId: string,
      ) => {
        mean: number;
        max: number;
        changed: number;
      };
    };
  }
}

async function installPixelProbe(page: Page) {
  await page.evaluate(() => {
    const shots = new Map<string, { pixels: Uint8ClampedArray; metadata: PixelShot }>();
    const perf = (
      window as unknown as {
        __varvePerf?: { getLast: () => { camera?: PixelCamera } | null };
      }
    ).__varvePerf;
    window.__frequencyProbe = {
      capture: (id) => {
        const el = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
        const ctx = el?.getContext('2d');
        const camera = perf?.getLast()?.camera;
        if (!el || !ctx || !camera) return null;
        const image = ctx.getImageData(0, 0, el.width, el.height);
        let alphaSum = 0;
        for (let i = 3; i < image.data.length; i += 4 * 97) alphaSum += image.data[i]!;
        if (!alphaSum) return null;
        const metadata = { id, width: image.width, height: image.height, camera: { ...camera } };
        // Retain RGBA locally: transferring millions of numbers through the
        // protocol and trace recorder adds no evidence to a numeric oracle.
        shots.set(id, { pixels: image.data, metadata });
        return metadata;
      },
      diff: (firstId, secondId) => {
        const a = shots.get(firstId);
        const b = shots.get(secondId);
        if (!a || !b) throw new Error('Pixel comparison is missing a captured sample');
        if (a.metadata.width !== b.metadata.width || a.metadata.height !== b.metadata.height) {
          throw new Error('Pixel comparison requires identical canvas dimensions');
        }
        let sum = 0;
        let max = 0;
        let changed = 0;
        let count = 0;
        for (let i = 0; i < a.pixels.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(a.pixels[i + c]! - b.pixels[i + c]!);
            sum += d;
            if (d > max) max = d;
            if (d > 2) changed++;
            count++;
          }
        }
        return { mean: count ? sum / count : 0, max, changed: count ? changed / count : 0 };
      },
    };
  });
}

async function capture(page: Page, id: string): Promise<PixelShot> {
  let shot: PixelShot | null = null;
  await expect
    .poll(
      async () => {
        shot = await page.evaluate((name) => window.__frequencyProbe!.capture(name), id);
        return shot !== null;
      },
      { timeout: 10_000, message: 'canvas must paint before pixel capture' },
    )
    .toBe(true);
  return shot!;
}

async function diff(page: Page, a: PixelShot, b: PixelShot) {
  expect({ width: b.width, height: b.height }).toEqual({ width: a.width, height: a.height });
  expect(b.camera).toEqual(a.camera);
  return page.evaluate(([firstId, secondId]) => window.__frequencyProbe!.diff(firstId, secondId), [
    a.id,
    b.id,
  ] as const);
}

async function forceAuthoritativeRedraw(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const perf = (
      window as unknown as {
        __varvePerf?: { forceFullRedraw: () => Promise<{ authoritative: boolean }> };
      }
    ).__varvePerf;
    if (!perf) throw new Error('Full-redraw oracle is unavailable');
    return perf.forceFullRedraw();
  });
  expect(result.authoritative).toBe(true);
}

async function restoreCaptureCamera(page: Page, original: PixelShot): Promise<void> {
  // Selection restoration changes contextual chrome. Let that layout settle,
  // then restore the exact camera instead of comparing resized coordinates.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect
    .poll(() =>
      page.getByTestId('editor-canvas').evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return { width: canvas.width, height: canvas.height };
      }),
    )
    .toEqual({ width: original.width, height: original.height });
  const changed = await page.evaluate((camera) => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
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
    return perf?.camera.setState({
      zoom: camera.zoom,
      pan: { x: camera.panX, y: camera.panY },
      rotation: camera.rotation,
    });
  }, original.camera);
  expect(changed).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __varvePerf?: { getLast: () => { camera?: PixelCamera } | null };
            }
          ).__varvePerf?.getLast()?.camera,
      ),
    )
    .toEqual(original.camera);
  await forceAuthoritativeRedraw(page);
}

async function runPaletteAction(page: Page, query: string, optionName: RegExp) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.waitFor({ timeout: 30_000 });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill(query);
  await palette.getByRole('option', { name: optionName }).first().click({ timeout: 15_000 });
  await expect(palette).toBeHidden({ timeout: 10_000 });
}

async function openEditorWithRetouchFixture(page: Page): Promise<void> {
  await navigateToEditor(page, '/?perf=1', { startupTimeout: 300_000 });
  const applied = await page.evaluate(() => window.__varvePerf?.fixtures.apply('retouch-raster'));
  expect(applied?.ok).toBe(true);
  await page
    .locator('.layers-panel')
    .getByText(/raster layer/i)
    .first()
    .waitFor({ timeout: 15_000 });
}

test.describe('frequency separation', () => {
  test('applying separation is visually identical and undo restores the layer', async ({
    page,
  }, testInfo) => {
    await openEditorWithRetouchFixture(page);
    await installPixelProbe(page);
    await page
      .locator('.layers-panel')
      .getByText(/raster layer/i)
      .first()
      .click();
    await page.waitForTimeout(500);
    await forceAuthoritativeRedraw(page);
    const before = await capture(page, 'before');
    await testInfo.attach('fs-before', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });

    await runPaletteAction(page, 'Frequency Separation', /Frequency Separation/);
    const dialog = page.getByRole('dialog', { name: /Frequency Separation/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // The dialog preview and the measured tolerance are present before commit.
    await expect(dialog.getByText(/Reconstruction error/i)).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: /Create Separation/i }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // Bands appear as ordinary layers in the group.
    await expect(page.locator('.layers-panel').getByText(/Tone/).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page
        .locator('.layers-panel')
        .getByText(/Detail/)
        .first(),
    ).toBeVisible({
      timeout: 20_000,
    });

    await page.waitForTimeout(900);
    await forceAuthoritativeRedraw(page);
    const after = await capture(page, 'after');
    const metrics = await diff(page, before, after);
    await testInfo.attach('fs-after', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });
    // Reconstruction is exact within 1 LSB/channel; rendering may add isolated
    // antialias differences at hard edges, but the image must not change.
    expect(metrics.mean).toBeLessThan(0.5);
    expect(metrics.max).toBeLessThanOrEqual(8);
    expect(metrics.changed).toBeLessThan(0.005);

    // One undo restores the plain raster layer.
    await page.keyboard.press('Control+z');
    const rasterLayer = page.getByRole('treeitem', {
      name: 'Raster Layer, Raster layer',
      exact: true,
    });
    await expect(rasterLayer).toBeVisible();
    await rasterLayer.click();
    await expect(rasterLayer).toHaveAttribute('aria-selected', 'true');
    await restoreCaptureCamera(page, before);
    const restored = await capture(page, 'restored');
    const undoMetrics = await diff(page, before, restored);
    expect(undoMetrics.mean).toBeLessThan(0.1);
  });

  test('re-splitting preserves the current composite', async ({ page }) => {
    await openEditorWithRetouchFixture(page);
    await installPixelProbe(page);
    await page
      .locator('.layers-panel')
      .getByText(/raster layer/i)
      .first()
      .click();
    await runPaletteAction(page, 'Frequency Separation', /Frequency Separation/);
    const dialog = page.getByRole('dialog', { name: /Frequency Separation/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: /Create Separation/i }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await forceAuthoritativeRedraw(page);
    const separated = await capture(page, 'separated');

    // Re-open on the group (select it first) and change the radius.
    await page
      .locator('.layers-panel')
      .getByText(/Frequency Separation/)
      .first()
      .click();
    await runPaletteAction(page, 'Frequency Separation', /Frequency Separation/);
    const reDialog = page.getByRole('dialog', { name: /Re-split/i });
    await expect(reDialog).toBeVisible({ timeout: 15_000 });
    await reDialog.getByRole('button', { name: /Re-split/i }).click();
    await expect(reDialog).toBeHidden({ timeout: 30_000 });
    await page.waitForTimeout(900);
    await forceAuthoritativeRedraw(page);
    const reSplit = await capture(page, 're-split');
    const metrics = await diff(page, separated, reSplit);
    // Re-splitting only moves the split point; the composite itself is kept.
    expect(metrics.mean).toBeLessThan(0.5);
  });
});
