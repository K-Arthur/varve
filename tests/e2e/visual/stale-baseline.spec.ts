/**
 * Stale-baseline visual oracle — the dirty-diff baseline must be the
 * document a frame actually PAINTED, not the last one that was still
 * current when it completed.
 *
 * The editor's render pipeline is asynchronous (buildIr is a Tauri IPC await
 * on desktop). When a document change lands while a frame is in flight, the
 * frame still paints its captured document — the surface then shows THAT
 * document's pixels. If the next frame's dirty region is diffed against an
 * older document (the pre-fix production rule), every pixel the overtaken
 * frame painted lies outside the damage region and survives as a stale
 * ghost: a deleted node's silhouette frozen at its last painted position.
 *
 * The harness page runs the REAL production diff functions
 * (`computeDocumentDirtyRegion` + the paint path's screen-rect mapping) over
 * the exact three-document sequence and paints it with the real canvas 2D
 * rasterizer:
 *
 *   full(L) → partial(A in dirty(L→A)) → partial(B in dirty(baseline→B))
 *
 * and diffs the result against a clean full render of B, so the ghost is
 * measured in real pixels.
 */

import { expect, test } from '@playwright/test';

interface ScenarioResult {
  diffPixels: number;
  maxDelta: number;
  total: number;
  ghostDiffPixels: number;
  otherDiffPixels: number;
  rectsPaintedDoc: { x: number; y: number; w: number; h: number }[];
  rectsBuggy: { x: number; y: number; w: number; h: number }[];
}

async function runScenario(
  page: import('@playwright/test').Page,
  rule: 'buggy' | 'painted-doc',
): Promise<ScenarioResult> {
  await page.goto('/visual-harness.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    { timeout: 15000 },
  );
  return page.evaluate(
    (ruleArg) =>
      (
        window as unknown as {
          __runStaleBaselineScenario: (r: 'buggy' | 'painted-doc') => ScenarioResult;
        }
      ).__runStaleBaselineScenario(ruleArg),
    rule,
  );
}

test.describe('stale dirty-diff baseline (overtaken frame)', () => {
  test('diffing against the older completed doc ghosts the deleted node at the intermediate position', async ({
    page,
  }) => {
    // Pre-fix production rule: frame 3 diffs L → B. The intermediate
    // position A painted is in neither document, so the ghost survives.
    const result = await runScenario(page, 'buggy');
    expect(result.rectsBuggy.length).toBeGreaterThan(0);
    expect(result.rectsPaintedDoc.length).toBeGreaterThan(0);
    // The buggy rects cover only the origin position — not the intermediate
    // position (200,400) the overtaken frame painted.
    const coversIntermediate = result.rectsBuggy.some(
      (r) => r.x <= 200 && r.y <= 400 && r.x + r.w >= 240 && r.y + r.h >= 440,
    );
    expect(coversIntermediate, JSON.stringify(result.rectsBuggy)).toBe(false);
    expect(result.diffPixels, JSON.stringify(result)).toBeGreaterThan(0);
    // The diff is exactly the ghost silhouette: only the intermediate
    // position differs, nothing else.
    expect(result.ghostDiffPixels, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.otherDiffPixels, JSON.stringify(result)).toBe(0);
  });

  test('diffing against the painted doc is pixel-identical to a full render of B', async ({
    page,
  }) => {
    // Post-fix production rule: frame 3 diffs A → B, clearing every pixel
    // the overtaken frame painted.
    const result = await runScenario(page, 'painted-doc');
    expect(result.rectsPaintedDoc.length).toBeGreaterThan(0);
    const coversIntermediate = result.rectsPaintedDoc.some(
      (r) => r.x <= 200 && r.y <= 400 && r.x + r.w >= 240 && r.y + r.h >= 440,
    );
    expect(coversIntermediate, JSON.stringify(result.rectsPaintedDoc)).toBe(true);
    expect(result.diffPixels, JSON.stringify(result)).toBe(0);
  });
});
