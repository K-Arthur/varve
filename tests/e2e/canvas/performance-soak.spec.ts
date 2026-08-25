import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

interface BitmapBudgetSnapshot {
  budgetBytes: number;
  pendingBytes: number;
  inFlightBytes: number;
  residentBytes: number;
  workerCanvasBytes: number;
  peakTotalBytes: number;
}

interface SoakDiagnostics {
  frameCount: number;
  traceCount: number;
  maxSpanCount: number;
  maxTraceFrameCount: number;
  bitmap: BitmapBudgetSnapshot | null;
}

interface ChromiumPerformanceMetrics {
  metrics: Array<{ name: string; value: number }>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

test.describe('Canvas interaction soak', () => {
  test('keeps diagnostic retention and worker bitmap resources bounded', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page, '/?perf=1');
    await seedLayers(page, 12);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapSamples: number[] = [];
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Alternate real middle-button pans so the viewport returns near its
    // starting point instead of growing document/camera state each cycle.
    for (let iteration = 0; iteration < 24; iteration++) {
      const direction = iteration % 2 === 0 ? 1 : -1;
      await page.mouse.move(center.x, center.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(center.x + direction * 48, center.y + direction * 24);
      await page.mouse.up({ button: 'middle' });
      await page.waitForTimeout(20);

      if ((iteration + 1) % 4 === 0) {
        await cdp.send('HeapProfiler.collectGarbage');
        const metrics = (await cdp.send('Performance.getMetrics')) as ChromiumPerformanceMetrics;
        heapSamples.push(
          metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0,
        );
      }
    }

    await expect
      .poll(() =>
        page.evaluate(() => {
          const handle = (
            window as unknown as {
              __varvePerf?: {
                workerBitmapBudget: () => BitmapBudgetSnapshot | null;
              };
            }
          ).__varvePerf;
          const bitmap = handle?.workerBitmapBudget();
          return (bitmap?.pendingBytes ?? 0) + (bitmap?.inFlightBytes ?? 0);
        }),
      )
      .toBe(0);

    const diagnostics = await page.evaluate<SoakDiagnostics | null>(() => {
      const handle = (
        window as unknown as {
          __varvePerf?: {
            getFrames: (count: number) => unknown[];
            interactions: {
              getTraces: (count: number) => Array<{ spans: unknown[]; frames: unknown[] }>;
              count: () => number;
            };
            workerBitmapBudget: () => BitmapBudgetSnapshot | null;
          };
        }
      ).__varvePerf;
      if (!handle) return null;
      const traces = handle.interactions.getTraces(50);
      return {
        frameCount: handle.getFrames(1_000).length,
        traceCount: handle.interactions.count(),
        maxSpanCount: Math.max(0, ...traces.map((trace) => trace.spans.length)),
        maxTraceFrameCount: Math.max(0, ...traces.map((trace) => trace.frames.length)),
        bitmap: handle.workerBitmapBudget(),
      };
    });

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.frameCount).toBeLessThanOrEqual(120);
    expect(diagnostics?.traceCount).toBeGreaterThan(0);
    expect(diagnostics?.traceCount).toBeLessThanOrEqual(50);
    expect(diagnostics?.maxSpanCount).toBeLessThanOrEqual(512);
    expect(diagnostics?.maxTraceFrameCount).toBeLessThanOrEqual(240);
    if (diagnostics?.bitmap) {
      expect(diagnostics.bitmap.pendingBytes).toBe(0);
      expect(diagnostics.bitmap.inFlightBytes).toBe(0);
      expect(diagnostics.bitmap.residentBytes).toBeGreaterThanOrEqual(0);
      expect(diagnostics.bitmap.workerCanvasBytes).toBeGreaterThanOrEqual(0);
      expect(diagnostics.bitmap.peakTotalBytes).toBeGreaterThanOrEqual(0);
    }

    // This is a deliberately generous browser-smoke ceiling, not an RSS or
    // device-memory claim. The deterministic gates above catch unbounded app
    // resources; this only rejects extreme late-window JS-heap growth.
    expect(heapSamples).toHaveLength(6);
    const previousWindow = median(heapSamples.slice(0, 3));
    const finalWindow = median(heapSamples.slice(3));
    await testInfo.attach('canvas-performance-soak.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            schemaVersion: 1,
            project: testInfo.project.name,
            iterations: 24,
            heapSamplesBytes: heapSamples,
            previousWindowMedianBytes: previousWindow,
            finalWindowMedianBytes: finalWindow,
            growthBytes: finalWindow - previousWindow,
            diagnostics,
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
    expect(finalWindow - previousWindow).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
