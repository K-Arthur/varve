/**
 * Effects-heavy worker frame regression.
 *
 * This reproduces the case where a previously painted worker frame can be
 * reprojected after camera input but no current frame replaces it. The pixel
 * oracle compares the live surface with an independent main-thread redraw at
 * the exact same camera state.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

type PerfSeam = {
  fixtures?: { apply: (id: string) => Promise<{ ok: boolean }> };
  probeOffscreen?: () => Promise<{ capability: string; stage?: string; error?: string }>;
  workerStatus?: () => {
    hostCreated: boolean;
    permanentFailure: boolean;
    failureReason?: string | null;
    ready: boolean;
    startupDurationMs: number | null;
    restartCount: number;
    inFlightRenderRevision?: number | null;
    pendingRenderRevision?: number | null;
    lastAcceptedRenderRevision?: number | null;
  };
  renderPath?: () => {
    observedWorkerFrames: number;
    observedMainThreadFrames: number;
    workerPolicyAllowed: boolean;
    workerHostCreated: boolean;
    offscreenCanvasVerified: boolean;
  };
  forceFullRedraw?: () => Promise<{
    authoritative: boolean;
    renderPath: string;
    frameIndex: number;
  }>;
  getFrames?: (count: number) => Array<Record<string, unknown>>;
};

async function surfaceHash(
  page: import('@playwright/test').Page,
  keepPixelSnapshot = false,
): Promise<string> {
  return page
    .locator('canvas.editor-canvas__content-layer')
    .evaluate(async (element, keepSnapshot) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas context unavailable');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      if (keepSnapshot) {
        (window as unknown as { __varveOracleBefore?: Uint8ClampedArray }).__varveOracleBefore =
          pixels.slice();
      }
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    }, keepPixelSnapshot);
}

async function assertMatchesMainThreadOracle(
  page: import('@playwright/test').Page,
  label: string,
  outputPath: (name: string) => string,
): Promise<string> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const fileLabel = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  await canvas.screenshot({ path: outputPath(`${fileLabel}-live.png`) });
  const live = await surfaceHash(page, true);
  const result = await page.evaluate(() =>
    (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.forceFullRedraw?.(),
  );
  expect(result, 'authoritative redraw oracle must be installed').toBeTruthy();
  expect(result?.authoritative).toBe(true);
  expect(['compositor', 'structural']).toContain(result?.renderPath);
  const authoritative = await surfaceHash(page);
  await canvas.screenshot({ path: outputPath(`${fileLabel}-authoritative.png`) });
  const details =
    live === authoritative
      ? null
      : await page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          const context = canvas.getContext('2d');
          const before = (window as unknown as { __varveOracleBefore?: Uint8ClampedArray })
            .__varveOracleBefore;
          if (!context || !before) return { error: 'pixel snapshot unavailable' };
          const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let differentPixels = 0;
          let maxChannelDelta = 0;
          let minX = canvas.width;
          let minY = canvas.height;
          let maxX = -1;
          let maxY = -1;
          for (let offset = 0; offset < after.length; offset += 4) {
            const delta = Math.max(
              Math.abs(after[offset]! - before[offset]!),
              Math.abs(after[offset + 1]! - before[offset + 1]!),
              Math.abs(after[offset + 2]! - before[offset + 2]!),
              Math.abs(after[offset + 3]! - before[offset + 3]!),
            );
            if (delta === 0) continue;
            differentPixels += 1;
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            const pixel = offset / 4;
            const x = pixel % canvas.width;
            const y = Math.floor(pixel / canvas.width);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
          delete (window as unknown as { __varveOracleBefore?: Uint8ClampedArray })
            .__varveOracleBefore;
          return { differentPixels, maxChannelDelta, bounds: [minX, minY, maxX, maxY] };
        });
  const frames =
    live === authoritative
      ? []
      : await page.evaluate(
          () => (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.getFrames?.(8) ?? [],
        );
  expect(
    live,
    `${label}: live pixels must match the main-thread redraw; diff=${JSON.stringify(details)} frames=${JSON.stringify(frames)}`,
  ).toBe(authoritative);
  return live;
}

test('effects-heavy navigation stays on the pixel-exact main-thread path', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // The correctness oracle starts with the explicit Full-quality setting;
  // Automatic is measured separately so a temporary preview scale cannot
  // blur a backend-pixel parity result.
  await page.addInitScript(() => {
    const key = 'varve-editor-settings';
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    } catch {
      settings = {};
    }
    const render =
      settings.render && typeof settings.render === 'object'
        ? (settings.render as Record<string, unknown>)
        : {};
    localStorage.setItem(
      key,
      JSON.stringify({ ...settings, render: { ...render, interactivePreview: 'full' } }),
    );
  });
  await navigateToEditor(page, '/?perf=1');

  const capability = await page.evaluate(() =>
    (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.probeOffscreen?.(),
  );
  expect(capability, 'OffscreenCanvas probe must be available').toMatchObject({
    capability: 'offscreen-supported',
  });

  const beforeFixture = await page.evaluate(() =>
    (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.renderPath?.(),
  );
  expect(beforeFixture, 'render-path diagnostics must be installed').toBeTruthy();
  expect(beforeFixture?.offscreenCanvasVerified).toBe(true);
  const initialAcceptedRevision = await page.evaluate(
    () =>
      (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.workerStatus?.()
        ?.lastAcceptedRenderRevision,
  );

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible();
  await canvas.focus();

  // Start with a small scene and prove this test really installs and receives
  // a worker frame before exercising the timeout/fallback with effects. That
  // leaves a real retained bitmap behind for the stale-frame oracle to check.
  const simpleFixture = await page.evaluate(() =>
    (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.fixtures?.apply('vector-100'),
  );
  expect(simpleFixture?.ok).toBe(true);
  await page.keyboard.press('Shift+1');
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.renderPath?.(),
        ),
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toMatchObject({ workerPolicyAllowed: true, workerHostCreated: true });
  const simpleWorkerEvidence = await page.waitForFunction(
    ({ baseline }) => {
      const worker = (
        window as unknown as { __varvePerf?: PerfSeam }
      ).__varvePerf?.workerStatus?.();
      const accepted = worker?.lastAcceptedRenderRevision;
      return accepted !== null && accepted !== undefined && accepted > baseline ? accepted : false;
    },
    { baseline: initialAcceptedRevision ?? -1 },
    { timeout: 30_000 },
  );
  expect(await simpleWorkerEvidence.jsonValue()).toBeGreaterThan(initialAcceptedRevision ?? -1);
  await assertMatchesMainThreadOracle(page, 'settled simple worker frame', (name) =>
    info.outputPath(name),
  );
  const simpleAcceptedRevision = await page.evaluate(
    () =>
      (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.workerStatus?.()
        ?.lastAcceptedRenderRevision,
  );

  const applied = await page.evaluate(() =>
    (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.fixtures?.apply('effects-heavy'),
  );
  expect(applied?.ok).toBe(true);
  const fixtureAppliedAt = await page.evaluate(() => performance.now());

  await page.keyboard.press('Shift+1');
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.renderPath?.(),
        ),
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toMatchObject({
      workerPolicyAllowed: true,
      workerHostCreated: true,
      offscreenCanvasVerified: true,
    });
  const workerEvidence = await page.waitForFunction(
    ({ baseline, afterFixtureAt }) => {
      const diagnostics = (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf;
      const worker = diagnostics?.workerStatus?.();
      if (!worker?.hostCreated) return false;
      const frame = (diagnostics?.getFrames?.(16) ?? []).find(
        (entry) =>
          entry.nodeCount === 150 &&
          entry.actualDrawingPath === 'canvas2d-main' &&
          typeof entry.committedAt === 'number' &&
          entry.committedAt >= afterFixtureAt,
      );
      if (
        frame &&
        worker.lastAcceptedRenderRevision === baseline &&
        worker.inFlightRenderRevision === null &&
        worker.pendingRenderRevision === null
      ) {
        return {
          acceptedRenderRevision: worker.lastAcceptedRenderRevision,
          currentFrame: frame,
          reason: 'effect-scene-pixel-parity-fallback',
        };
      }
      return false;
    },
    { baseline: simpleAcceptedRevision ?? -1, afterFixtureAt: fixtureAppliedAt },
    { timeout: 30_000 },
  );
  const workerEvidenceValue = (await workerEvidence.jsonValue()) as {
    acceptedRenderRevision: number | null;
    currentFrame: Record<string, unknown>;
    reason: string;
  };
  expect(workerEvidenceValue.acceptedRenderRevision).toBe(simpleAcceptedRevision);
  expect(workerEvidenceValue.currentFrame.actualDrawingPath).toBe('canvas2d-main');
  const workerFrames = await page.evaluate(
    () => (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.getFrames?.(12) ?? [],
  );
  const workerStatus = await page.evaluate(() =>
    (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.workerStatus?.(),
  );
  await info.attach('worker-frame-evidence.json', {
    body: JSON.stringify(
      {
        simpleAcceptedRevision,
        effectsOutcome: workerEvidenceValue,
        workerStatus,
        recentFrames: workerFrames,
        evidenceLimits: [
          'rAF and frame commit timings are not input-to-photon latency',
          'Playwright Chromium evidence is not native WebKitGTK or physical input evidence',
        ],
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  console.log(
    `[canvas-fluidity:worker-evidence] ${JSON.stringify({
      simpleAcceptedRevision,
      effectsOutcome: workerEvidenceValue,
      workerStatus,
      recentFrames: workerFrames,
    })}`,
  );
  await assertMatchesMainThreadOracle(page, 'initial settled effects scene', (name) =>
    info.outputPath(name),
  );
  const acceptedEffectsRevision = await page.evaluate(
    () =>
      (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.workerStatus?.()
        ?.lastAcceptedRenderRevision,
  );
  const cameraBeforeNavigation = await page.evaluate(
    () =>
      (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.getFrames?.(1)?.[0]?.camera as
        | { zoom: number; panX: number; panY: number; rotation: number }
        | undefined,
  );
  expect(cameraBeforeNavigation).toBeTruthy();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Two short navigation bursts verify the fidelity fallback stays coherent
  // through camera changes after the scene leaves worker eligibility. Capture
  // the input boundary before dispatch: the event handler can synchronously
  // replay a heavy scene before Playwright resolves mouse.wheel().
  const finalInputAt = await page.evaluate(() => performance.now());
  await page.mouse.wheel(0, -12);
  await page.waitForTimeout(16);
  await canvas.screenshot({
    path: info.outputPath('effects-navigation-first-frame.png'),
  });
  await page.mouse.wheel(0, 9);
  await page.waitForTimeout(500);
  await canvas.screenshot({
    path: info.outputPath('effects-navigation-500ms.png'),
  });
  const navigationFrames = await page.evaluate(
    () => (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.getFrames?.(120) ?? [],
  );
  const currentMainFrame = navigationFrames.find((entry) => {
    const frame = entry as {
      camera?: { zoom: number; panX: number; panY: number; rotation: number };
      actualDrawingPath?: string;
      committedAt?: number;
    };
    const camera = frame.camera;
    return (
      frame.actualDrawingPath === 'canvas2d-main' &&
      typeof frame.committedAt === 'number' &&
      frame.committedAt >= finalInputAt &&
      camera !== undefined &&
      (camera.zoom !== cameraBeforeNavigation?.zoom ||
        camera.panX !== cameraBeforeNavigation?.panX ||
        camera.panY !== cameraBeforeNavigation?.panY ||
        camera.rotation !== cameraBeforeNavigation?.rotation)
    );
  });
  expect(
    currentMainFrame,
    `camera input must commit a fresh main-thread frame; before=${JSON.stringify(cameraBeforeNavigation)} frames=${JSON.stringify(navigationFrames.slice(-12))}`,
  ).toBeTruthy();
  const acceptedRevisionAfterNavigation = await page.evaluate(
    () =>
      (window as unknown as { __varvePerf?: PerfSeam }).__varvePerf?.workerStatus?.()
        ?.lastAcceptedRenderRevision,
  );
  expect(acceptedRevisionAfterNavigation).toBe(acceptedEffectsRevision);
  const navigationOutcome = {
    kind: 'main-thread',
    frame: currentMainFrame,
    acceptedEffectsRevision,
  };
  await info.attach('navigation-frame-evidence.json', {
    body: JSON.stringify(navigationOutcome, null, 2),
    contentType: 'application/json',
  });
  console.log(`[canvas-fluidity:navigation-evidence] ${JSON.stringify(navigationOutcome)}`);

  const finalHash = await assertMatchesMainThreadOracle(
    page,
    'settled effects navigation',
    (name) => info.outputPath(name),
  );
  expect(finalHash.length).toBe(64);
  await canvas.screenshot({ path: info.outputPath('effects-main-thread-refinement.png') });
});
