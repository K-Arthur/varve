/**
 * Frequency Separation E2E — real canvas, real dialog, real render pipeline.
 *
 * The critical invariant is visual: before separation is applied the canvas
 * must show the source; after separation it must show the same pixels (the
 * decode is ±1 LSB / channel). Pixel comparison reads the real canvas buffer
 * in-page via `getImageData`, which is immune to screenshot timing artifacts;
 * element screenshots are attached for human review only.
 *
 * Run with:
 *   npx playwright test tests/e2e/canvas/frequency-separation.spec.ts --project=chromium --reporter=list
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(360_000);

declare global {
  interface Window {
    __varvePerf?: {
      fixtures: {
        apply: (id: string) => Promise<{ ok: boolean }>;
      };
      forceFullRedraw: () => void;
    };
    __retouchProbe?: {
      capture: () => { width: number; height: number; data: number[] } | null;
      diff: (
        a: { data: number[] },
        b: { data: number[] },
      ) => { mean: number; max: number; changed: number };
    };
  }
}

async function installPixelProbe(page: Page) {
  await page.evaluate(() => {
    const canvas = (): HTMLCanvasElement | null =>
      document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
    window.__retouchProbe = {
      capture: () => {
        const el = canvas();
        const ctx = el?.getContext('2d');
        if (!el || !ctx) return null;
        const image = ctx.getImageData(0, 0, el.width, el.height);
        return { width: image.width, height: image.height, data: Array.from(image.data) };
      },
      diff: (a, b) => {
        let sum = 0;
        let max = 0;
        let changed = 0;
        let count = 0;
        const len = Math.min(a.data.length, b.data.length);
        for (let i = 0; i < len; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(a.data[i + c]! - b.data[i + c]!);
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

async function capture(page: Page) {
  // Wait for a painted frame: the first paint after navigation can lag under
  // load, and a blank buffer would poison every later comparison.
  for (let attempt = 0; attempt < 40; attempt++) {
    const shot = await page.evaluate(() => window.__retouchProbe!.capture());
    if (shot) {
      let alphaSum = 0;
      for (let i = 3; i < shot.data.length; i += 4 * 97) alphaSum += shot.data[i]!;
      if (alphaSum > 0) return shot;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('canvas never painted');
}

async function diff(page: Page, a: { data: number[] }, b: { data: number[] }) {
  return page.evaluate(([first, second]) => window.__retouchProbe!.diff(first!, second!), [
    a,
    b,
  ] as const);
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
    const before = await capture(page);
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
    await page.evaluate(() => window.__varvePerf?.forceFullRedraw());
    await page.waitForTimeout(400);
    const after = await capture(page);
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
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__varvePerf?.forceFullRedraw());
    await page.waitForTimeout(400);
    const restored = await capture(page);
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
    await page.evaluate(() => window.__varvePerf?.forceFullRedraw());
    const separated = await capture(page);

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
    await page.evaluate(() => window.__varvePerf?.forceFullRedraw());
    await page.waitForTimeout(400);
    const reSplit = await capture(page);
    const metrics = await diff(page, separated, reSplit);
    // Re-splitting only moves the split point; the composite itself is kept.
    expect(metrics.mean).toBeLessThan(0.5);
  });
});
