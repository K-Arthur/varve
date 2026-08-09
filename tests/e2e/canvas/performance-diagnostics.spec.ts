import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

interface PerformanceDiagnosticsHandle {
  getFrames: (count: number) => Array<{
    partialRedraw: boolean;
    dirtyScreenRect?: { x: number; y: number; w: number; h: number };
  }>;
  interactions: {
    getTraces: (count: number) => Array<{
      schemaVersion: number;
      kind: string;
      spans: Array<{ name: string }>;
      frames: unknown[];
      droppedSpanCount: number;
      droppedFrameCount: number;
    }>;
    summary: () => {
      pointerToPresent: { count: number; p95: number; p99: number };
      total: { count: number; p95: number; p99: number };
    };
  };
  freeze: (frozen: boolean) => void;
  isFrozen: () => boolean;
}

test.describe('Canvas performance diagnostics', () => {
  test('captures a real drag with bounded spans and an inspectable dirty region', async ({
    page,
  }) => {
    await navigateToEditor(page, '/?perf=1');
    await seedLayers(page, 1);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('v');
    await page.mouse.click(box.x + 140, box.y + 140);
    await page.mouse.move(box.x + 140, box.y + 140);
    await page.mouse.down();
    await page.mouse.move(box.x + 210, box.y + 190);
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const handle = (
            window as unknown as {
              __strataPerf?: PerformanceDiagnosticsHandle;
            }
          ).__strataPerf;
          return handle?.interactions.getTraces(10).length ?? 0;
        }),
      )
      .toBeGreaterThan(0);

    const diagnostics = await page.evaluate(() => {
      const handle = (
        window as unknown as {
          __strataPerf?: PerformanceDiagnosticsHandle;
        }
      ).__strataPerf;
      if (!handle) return null;
      const traces = handle.interactions.getTraces(10);
      const drag = [...traces]
        .reverse()
        .find((trace) => trace.spans.some((span) => span.name === 'pointer.input'));
      const dirtyFrame = [...handle.getFrames(120)]
        .reverse()
        .find((frame) => frame.partialRedraw && frame.dirtyScreenRect);
      handle.freeze(true);
      return {
        trace: drag,
        dirtyFrame,
        summary: handle.interactions.summary(),
        frozen: handle.isFrozen(),
      };
    });

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.trace?.schemaVersion).toBe(2);
    expect(diagnostics?.trace?.spans.length).toBeLessThanOrEqual(512);
    expect(diagnostics?.trace?.frames.length).toBeLessThanOrEqual(240);
    expect(diagnostics?.trace?.droppedSpanCount).toBeGreaterThanOrEqual(0);
    expect(diagnostics?.trace?.droppedFrameCount).toBeGreaterThanOrEqual(0);
    expect(diagnostics?.trace?.spans.map((span) => span.name)).toContain('snap.prefilter');
    expect(diagnostics?.trace?.spans.map((span) => span.name)).toContain('snap.evaluate');
    expect(diagnostics?.dirtyFrame?.dirtyScreenRect?.w).toBeGreaterThan(0);
    expect(diagnostics?.dirtyFrame?.dirtyScreenRect?.h).toBeGreaterThan(0);
    expect(diagnostics?.summary.total.p99).toBeGreaterThanOrEqual(
      diagnostics?.summary.total.p95 ?? 0,
    );
    expect(diagnostics?.frozen).toBe(true);
  });

  test('closes and classifies wheel and keyboard traces at their real boundaries', async ({
    page,
  }) => {
    await navigateToEditor(page, '/?perf=1');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    await canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          deltaMode: WheelEvent.DOM_DELTA_LINE,
          deltaY: 3,
        }),
      );
    });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const handle = (
            window as unknown as {
              __strataPerf?: PerformanceDiagnosticsHandle;
            }
          ).__strataPerf;
          return handle?.interactions
            .getTraces(10)
            .some(
              (trace) =>
                trace.kind === 'wheel' && trace.spans.some((span) => span.name === 'wheel.input'),
            );
        }),
      )
      .toBe(true);

    await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');

    await expect
      .poll(() =>
        page.evaluate(() => {
          const handle = (
            window as unknown as {
              __strataPerf?: PerformanceDiagnosticsHandle;
            }
          ).__strataPerf;
          return handle?.interactions
            .getTraces(10)
            .some(
              (trace) =>
                trace.kind === 'keyboard' &&
                trace.spans.some((span) => span.name === 'keyboard.input'),
            );
        }),
      )
      .toBe(true);
  });
});
