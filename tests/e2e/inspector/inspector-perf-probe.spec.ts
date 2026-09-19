/**
 * Inspector performance probe — absolute measurements, no before/after claim.
 *
 * The redesign pass made no render-path changes beyond a CSS layout rule, so
 * this probe records the current cost of the Inspector's two real workloads:
 *   1. selection switching (layers row click → Inspector panel settle)
 *   2. canvas drag with the Inspector mounted (rAF cadence while the
 *      selection's property rows re-render during the transform)
 *
 * Results are written to reports/inspector-redesign/perf/ and printed. They
 * are a baseline for future optimization work, not evidence of a change.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REPORT_DIR = path.resolve('reports/inspector-redesign/perf');

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 4 });
  await page.mouse.up();
}

test.describe('Inspector performance probe', () => {
  test.beforeEach(() => {
    mkdirSync(REPORT_DIR, { recursive: true });
  });

  test('selection switch settle time', async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawRect(page, 120, 140, 240, 240);
    await page.keyboard.press('Escape');
    await drawRect(page, 300, 260, 420, 360);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });
    await page.getByRole('tab', { name: 'Design' }).click();
    await expect(page.locator('#insp-tabpanel-properties')).toBeVisible();

    const samples = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll('[role="treeitem"]')];
      const panel = document.querySelector('#insp-tabpanel-properties');
      if (!panel || rows.length < 2) throw new Error('fixture missing');
      const settle = async (): Promise<number> => {
        const start = performance.now();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        return performance.now() - start;
      };
      const timings: number[] = [];
      for (let index = 0; index < 10; index += 1) {
        const row = rows[index % rows.length] as HTMLElement;
        const start = performance.now();
        row.click();
        // Two frames covers commit + paint for the panel subtree.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        timings.push(performance.now() - start);
      }
      const settleCost = await settle();
      return { timings, settleCost };
    });

    const sorted = [...samples.timings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
    const result = {
      scenario: 'selection-switch',
      samples: samples.timings.map((value) => Math.round(value * 10) / 10),
      medianMs: Math.round(median * 10) / 10,
      p95Ms: Math.round(p95 * 10) / 10,
    };
    writeFileSync(path.join(REPORT_DIR, 'selection-switch.json'), JSON.stringify(result, null, 2));
    console.log(`inspector perf selection-switch: ${JSON.stringify(result)}`);
  });

  test('canvas drag frame cadence with Inspector mounted', async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawRect(page, 160, 160, 330, 290);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: 'Design' }).click();
    await expect(page.locator('#insp-tabpanel-properties')).toBeVisible();

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    const frames = await page.evaluate(() => {
      const deltas: number[] = [];
      let last = performance.now();
      let running = true;
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      (window as unknown as { __stopFrameProbe: () => number[] }).__stopFrameProbe = () => {
        running = false;
        return deltas;
      };
      return true;
    });
    expect(frames).toBe(true);

    // Drag the rectangle for ~2 seconds.
    await page.mouse.move(box.x + 245, box.y + 225);
    await page.mouse.down();
    for (let step = 0; step < 60; step += 1) {
      await page.mouse.move(box.x + 245 + Math.sin(step / 6) * 80, box.y + 225 + step, {
        steps: 1,
      });
      await page.waitForTimeout(30);
    }
    await page.mouse.up();

    const deltas = await page.evaluate(() =>
      (window as unknown as { __stopFrameProbe: () => number[] }).__stopFrameProbe(),
    );
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
    const dropped = deltas.filter((delta) => delta > 40).length;
    const result = {
      scenario: 'canvas-drag-frame-cadence',
      frameCount: deltas.length,
      medianMs: Math.round(median * 10) / 10,
      p95Ms: Math.round(p95 * 10) / 10,
      droppedOver40ms: dropped,
    };
    writeFileSync(path.join(REPORT_DIR, 'canvas-drag.json'), JSON.stringify(result, null, 2));
    console.log(`inspector perf canvas-drag: ${JSON.stringify(result)}`);
  });
});
