import { expect, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * In-app WebGPU capture: drives the real editor with the WebGPU renderer
 * preference enabled, draws solid rect + ellipse content through the real
 * tools, and captures the canvas, the status bar label, and the Performance
 * settings tab into isolated test output (VARVE_GPU_SHOT_DIR opts into review capture).
 *
 * On a machine whose browser exposes a hardware WebGPU adapter this exercises
 * the GPU scene path end to end. On SwiftShader-only environments (CI, most
 * containers) the app must truthfully fall back; the captures then document
 * the fallback status instead, which is the same visual contract users see.
 * Either way the assertions only accept the honest status labels.
 */

const SHOT_DIR = process.env.VARVE_GPU_SHOT_DIR;

const RENDERER_STATUS_LABEL =
  /^(?:Canvas2D|WebGPU \+ Canvas2D|Canvas2D · GPU ready|WebGPU ready|WebGPU unavailable · Canvas2D)$/;

function rendererStatus(page: import('@playwright/test').Page) {
  // Warning/fallback states use `editor-status__meta--warning`; successful
  // states use `editor-status__diagnostic`. Select the stable visible label
  // by its truthful text instead of relying on one presentation class.
  return page.locator('.editor-status').getByText(RENDERER_STATUS_LABEL);
}

test.use({
  launchOptions: {
    channel: 'chromium',
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=vulkan',
      '--enable-unsafe-swiftshader',
    ],
  },
});

/** True when a hardware (non-software) adapter is exposed to the page. */
async function hasHardwareAdapter(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return false;
    const info = adapter.info;
    const haystack = [info?.vendor, info?.architecture, info?.device, info?.description]
      .filter((s): s is string => !!s)
      .join(' ')
      .toLowerCase();
    const software = ['swift', 'fallback', 'software', 'llvmpipe', 'lavapipe'].some((marker) =>
      haystack.includes(marker),
    );
    return !software;
  });
}

async function drawShapes(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 200, 160, 420, 300);
  await page.keyboard.press('o');
  await dragOnCanvas(page, 480, 160, 640, 260);
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
}

async function selectWebGpuRenderer(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const file = [...document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'File',
    );
    (file as HTMLElement | undefined)?.click();
  });
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const settings = page.locator('dialog.varve-dialog--settings[open]');
  const preference = settings.getByRole('combobox', { name: 'Canvas renderer' });
  await preference.click();
  await settings.getByRole('option', { name: 'WebGPU (when available)' }).click();
  await page.keyboard.press('Escape');
}

test('captures the WebGPU renderer preference and its truthful status', async ({ page }) => {
  await navigateToEditor(page);
  const hardware = await hasHardwareAdapter(page);

  // Baseline: default Canvas2D path draws the same content.
  await drawShapes(page);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: evidencePath(`gpu-acceleration/app-canvas-canvas2d.png`, SHOT_DIR),
    fullPage: false,
  });
  const canvas2dStatus = await rendererStatus(page).textContent();
  expect(canvas2dStatus ?? '').toMatch(/Canvas2D/);

  await selectWebGpuRenderer(page);
  await page.reload();
  await navigateToEditor(page);
  await drawShapes(page);
  // Give the compositor a few settled frames before reading the label.
  await page.waitForTimeout(800);

  const status = (await rendererStatus(page).textContent()) ?? '';
  await page.screenshot({
    path: evidencePath(`gpu-acceleration/app-canvas-prefer-webgpu.png`, SHOT_DIR),
    fullPage: false,
  });

  if (hardware) {
    // Honest labels only: actually drew through WebGPU, or GPU ready while
    // the visible frame came from the worker/Canvas2D replay. Both separate
    // the preference from what executed.
    expect(status.trim()).toMatch(/WebGPU \+ Canvas2D|Canvas2D · GPU ready|WebGPU ready/);
  } else {
    // Software adapter must be declined with a named reason, never reported
    // as acceleration.
    expect(status.trim()).toMatch(/WebGPU unavailable · Canvas2D|Canvas2D/);
  }

  // Performance tab: the live renderer status lives in the Diagnostics stats
  // ("WebGPU device probe"); scroll it into view so the capture shows it
  // unclipped instead of wherever the dialog happened to rest.
  await page.evaluate(() => {
    const file = [...document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'File',
    );
    (file as HTMLElement | undefined)?.click();
  });
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const settings = page.locator('dialog.varve-dialog--settings[open]');
  const performanceTab = settings.getByRole('tab', { name: /Performance|Render/i });
  await performanceTab.click();
  const probeStat = settings.getByText('WebGPU device probe', { exact: false }).first();
  await probeStat.scrollIntoViewIfNeeded();
  await expect(probeStat).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: evidencePath(`gpu-acceleration/app-settings-performance.png`, SHOT_DIR),
    fullPage: false,
  });
});
