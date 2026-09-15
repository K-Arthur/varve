import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface PerfProfileSeam {
  profile?: {
    tier?: () => string;
    renderScale?: () => number;
    setTierForTesting?: (tier: string) => void;
  };
  camera?: { setZoom?: (zoom: number) => void };
  forceFullRedraw?: () => boolean;
}

async function canvasGeometry(page: import('@playwright/test').Page) {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      dpr: window.devicePixelRatio,
    };
  });
}

async function canvasHash(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
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

test('interactive previews degrade at the tier scale and settle at full resolution', async ({
  page,
}, testInfo) => {
  test.setTimeout(12 * 60 * 1000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible();

  const seamAvailable = await page.evaluate(() => {
    const perf = (window as unknown as { __varvePerf?: PerfProfileSeam }).__varvePerf;
    if (!perf?.profile?.setTierForTesting) return false;
    perf.profile.setTierForTesting('performance');
    return true;
  });
  // The ?perf=1 profile seam must be installed for a deterministic tier.
  expect(seamAvailable).toBe(true);

  const settled = await canvasGeometry(page);
  expect(settled.dpr).toBeGreaterThan(0);
  // Settled frames render at full device resolution.
  expect(settled.backingWidth).toBe(Math.max(1, Math.round(settled.cssWidth * settled.dpr)));

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no layout box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Add inspectable content and zoom in so rasterization softness is visible
  // in the screenshots, then keep the shape selected so the overlay sharpness
  // can be compared against the previewed content.
  await canvas.focus();
  await page.keyboard.press('r');
  await page.mouse.move(cx - 220, cy - 130);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 130, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => {
    (window as unknown as { __varvePerf?: PerfProfileSeam }).__varvePerf?.camera?.setZoom?.(2);
  });
  await page.waitForTimeout(400);

  // Pan with the Hand tool: a camera change forces a content frame on every
  // move, so the preview scale is exercised while the interaction is open.
  await page.keyboard.press('h');

  // Re-assert the tier immediately before the gesture so the cooldown window
  // covers the whole drag.
  await page.evaluate(() => {
    (
      window as unknown as { __varvePerf?: PerfProfileSeam }
    ).__varvePerf?.profile?.setTierForTesting?.('performance');
  });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 30, { steps: 6 });
  await page.mouse.move(cx + 90, cy + 70, { steps: 10 });
  await page.waitForTimeout(250);

  const midDrag = await canvasGeometry(page);
  const midDragState = await page.evaluate(() => {
    const perf = (window as unknown as { __varvePerf?: PerfProfileSeam }).__varvePerf;
    return {
      tier: perf?.profile?.tier?.(),
      renderScale: perf?.profile?.renderScale?.(),
    };
  });
  expect(midDragState.tier).toBe('performance');
  expect(midDragState.renderScale).toBe(0.75);
  // An open interaction renders the preview at the tier scale.
  expect(midDrag.backingWidth).toBe(Math.max(1, Math.round(midDrag.cssWidth * midDrag.dpr * 0.75)));
  await page.screenshot({ path: '/tmp/varve-chromeos-stage3-visual/preview-scale-drag.png' });

  await page.mouse.move(cx + 260, cy + 150, { steps: 10 });
  await page.mouse.up();

  // The settled refinement requests a promoting frame after the interaction
  // quiets; 700 ms is well past the 180 ms quiet delay.
  await page.waitForTimeout(700);
  const restored = await canvasGeometry(page);
  // Settled frames return to full resolution.
  expect(restored.backingWidth).toBe(Math.max(1, Math.round(restored.cssWidth * restored.dpr)));
  await page.screenshot({ path: '/tmp/varve-chromeos-stage3-visual/preview-scale-settled.png' });

  // Pixel oracle: the settled surface must equal what an authoritative full
  // redraw would produce at the same camera. Paint pixels left over from the
  // preview scale would fail this comparison.
  const settledHash = await canvasHash(page);
  await page.evaluate(async () => {
    (window as unknown as { __varvePerf?: PerfProfileSeam }).__varvePerf?.forceFullRedraw?.();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // The settled surface must match an authoritative full redraw.
  expect(await canvasHash(page)).toBe(settledHash);

  await testInfo.attach('preview-scale-check', {
    body: JSON.stringify({ settled, midDrag, restored }, null, 2),
    contentType: 'application/json',
  });
});
