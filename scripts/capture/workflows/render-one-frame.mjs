#!/usr/bin/env node
/**
 * Video F — how the current Varve renderer produces one frame.
 *
 * The HUD is the application's existing development-only frame diagnostic.
 * It is enabled with ?perf=1 and a persisted diagnostics preference; the
 * workflow never changes the render policy or paints a substitute frame.
 */
import { strict as assert } from 'node:assert';
import {
  useTool as activateTool,
  beat,
  dragAt,
  fitContent,
  layerNames,
  openCleanEditor,
  parkPointer,
  selectLayer,
  settle,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

let observedFrame = null;
let observedPath = null;

await capture({
  slug: 'render-one-frame',
  workflow: 'How Varve renders one frame',
  purpose: 'A real frame diagnostic: document state, culling, cache, replay path and timing.',
  fixture: null,
  duration: [30, 50],
  initScripts: [
    () => {
      try {
        localStorage.setItem(
          'varve-editor-settings',
          JSON.stringify({
            performance: { reducedMotionOverride: 'always', showPerformanceDiagnostics: true },
          }),
        );
      } catch {
        /* the app will still expose ?perf=1 diagnostics if storage is unavailable */
      }
    },
  ],
  metadata: () => ({
    sourceMap: {
      documentAndScene: [
        'packages/editor/src/canvas/renderPipeline.ts',
        'packages/engine/src/engine.ts',
      ],
      visibilityAndCulling: ['packages/editor/src/canvas/renderPipeline.ts'],
      renderIrReplay: ['packages/engine/src/replay.ts'],
      canvas2dCompositor: ['packages/compositor/src/canvas2d/backend.ts'],
      optionalWebGpuRouter: [
        'packages/compositor/src/router.ts',
        'packages/compositor/src/webgpu/backend.ts',
      ],
      diagnostics: [
        'packages/editor/src/canvas/drawDiagnostics.ts',
        'packages/editor/src/canvas/perfRuntime.ts',
      ],
      architectureDoc: 'docs/architecture/render-pipeline.md',
    },
    observedFrame,
    observedPath,
  }),

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base, { query: '?perf=1' });
    // A moderately complex scene is built through production tools, so the
    // counts in the HUD belong to the same document the viewer sees.
    for (let i = 0; i < 8; i += 1) {
      await activateTool(page, i % 2 ? 'r' : 'o');
      const x = 0.08 + (i % 4) * 0.2;
      const y = 0.18 + Math.floor(i / 4) * 0.3;
      await dragAt(page, [x, y], [x + 0.13, y + 0.16], { steps: 10, settleMs: 100 });
    }
    await activateTool(page, 'v');
    await fitContent(page);
    await parkPointer(page);
    await settle(page, { pauseMs: 500 });
    assert.ok(
      (await layerNames(page)).length >= 8,
      'diagnostic scene did not contain enough nodes',
    );
    begin();
    await beat(page, 5000);

    const perf = await page.evaluate(() => {
      const handle = window.__strataPerf;
      return {
        enabled: Boolean(handle?.isEnabled?.()),
        frame: handle?.getLast?.() ?? null,
        path: handle?.renderPath?.() ?? null,
      };
    });
    assert.ok(perf.enabled && perf.frame, 'the existing dev-only frame HUD did not initialise');
    assertions.push(
      'the diagnostics HUD is enabled only through the explicit ?perf=1 capture gate',
    );
    await beat(page, 6500);

    // One real edit creates the next dirty frame. The editor's own diagnostics
    // decide whether it is a structural replay, worker path or compositor path.
    await selectLayer(page, /Rectangle|Ellipse/i);
    // Selection reveals the node in the production editor, which can zoom the
    // camera to it. Re-establish the deterministic whole-scene camera before
    // the edit so that this technical explainer does not look like a capture
    // glitch while the real selection/edit path remains visible.
    await fitContent(page);
    await parkPointer(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await settle(page, { pauseMs: 700 });
    const edited = await page.evaluate(() => ({
      frame: window.__strataPerf?.getLast?.() ?? null,
      path: window.__strataPerf?.renderPath?.() ?? null,
    }));
    assert.ok(edited.frame?.frameIndex >= perf.frame.frameIndex, 'edit did not commit a frame');
    // A single-node move is intentionally reported as a dirty-node replay by
    // the diagnostics layer. The initial scene assertion above proves the
    // document contains eight nodes; this frame may truthfully report only
    // the node participating in the partial redraw.
    assert.ok(Number(edited.frame.nodeCount) >= 1, 'diagnostic frame reported no drawable nodes');
    assert.ok(typeof edited.frame.renderPath === 'string', 'frame has no render path');
    observedFrame = edited.frame;
    observedPath = edited.path;
    assertions.push(
      `the edited frame reports ${edited.frame.nodeCount} nodes, ${edited.frame.culledCount} culled, ` +
        `${edited.frame.cacheHitCount} cache hits and ${edited.frame.renderPath} replay`,
    );
    await beat(page, 6500);

    await page.evaluate(() => window.__strataPerf?.freeze?.(true));
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => window.__strataPerf?.isFrozen?.()),
      true,
      'diagnostics frame could not be frozen',
    );
    assertions.push('the exact next frame is frozen for inspection; the HUD is observability only');
    await beat(page, 6500);
    await page.evaluate(() => window.__strataPerf?.freeze?.(false));
    await parkPointer(page);
    await beat(page, 5500);
    return assertions;
  },
});
