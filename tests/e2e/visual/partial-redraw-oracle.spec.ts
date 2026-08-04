/**
 * Partial-redraw visual oracle.
 *
 * Renders a scene through the trusted full-redraw path, then renders the
 * same scene through the partial-redraw path (per-rect clear + board fill +
 * multi-path clip over a PRUNED candidate subset) on top of the retained
 * pixels, and requires the two to be pixel-identical. A missing candidate,
 * an over-aggressive prune, a clip error or a seam between retained and
 * redrawn regions shows up as a diff — with the differing region available
 * for artifact saving on failure.
 *
 * The pruned subsets are computed by the spec with the same conservative
 * bounds rule as the production query (world render bounds intersection),
 * so the oracle validates the pruning CONTRACT, not the query implementation.
 */

import { expect, test } from '@playwright/test';
import type { RenderItem } from '@strata/engine';

const WIDTH = 480;
const HEIGHT = 360;

interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TEAL = { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 };
const RED = { space: 'rgb' as const, r: 220, g: 40, b: 40, a: 255 };
const BLUE = { space: 'rgb' as const, r: 40, g: 60, b: 220, a: 255 };

function rectItem(
  x: number,
  y: number,
  w: number,
  h: number,
  overrides: Partial<RenderItem> = {},
): RenderItem {
  return {
    transform: [1, 0, 0, 1, x, y],
    fill: TEAL,
    primitive: { kind: 'rect', x: 0, y: 0, w, h },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
    ...overrides,
  };
}

/** World AABB for a rect primitive under an identity-ish transform. */
function rectBounds(item: RenderItem): { x: number; y: number; w: number; h: number } {
  const [a, , , d, e, f] = item.transform;
  if (item.primitive.kind !== 'rect') throw new Error('oracle fixtures are rects only');
  const { x, y, w, h } = item.primitive;
  // Axis-aligned transform: use the max axis scale like the render bounds do.
  const scale = Math.max(Math.abs(a), Math.abs(d), 1);
  return { x: e + x * a, y: f + y * d, w: w * scale, h: h * scale };
}

function intersects(
  a: { x: number; y: number; w: number; h: number },
  rects: DirtyRect[],
): boolean {
  return rects.some(
    (b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
  );
}

/** Deterministic grid scene: 6x4 rects at 70px spacing, teal on white. */
function gridScene(): RenderItem[] {
  const items: RenderItem[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      items.push(rectItem(20 + col * 70, 20 + row * 70, 40, 40));
    }
  }
  return items;
}

async function openHarness(page: import('@playwright/test').Page) {
  await page.goto('/visual-harness.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    { timeout: 15000 },
  );
}

async function renderFull(
  page: import('@playwright/test').Page,
  items: RenderItem[],
): Promise<void> {
  await page.evaluate(
    ({ items: itemsArg, width, height }) => {
      (
        window as unknown as {
          __renderBoardFixture: (items: unknown[], w: number, h: number) => void;
        }
      ).__renderBoardFixture(itemsArg, width, height);
    },
    { items, width: WIDTH, height: HEIGHT },
  );
}

async function renderPartial(
  page: import('@playwright/test').Page,
  items: RenderItem[],
  dirtyRects: DirtyRect[],
): Promise<void> {
  await page.evaluate(
    ({ items: itemsArg, width, height, dirtyRects: rects }) => {
      (
        window as unknown as {
          __renderPartialFrame: (
            items: unknown[],
            w: number,
            h: number,
            rects: DirtyRect[],
          ) => void;
        }
      ).__renderPartialFrame(itemsArg, width, height, rects);
    },
    { items, width: WIDTH, height: HEIGHT, dirtyRects },
  );
}

/**
 * Oracle body: render full → capture → render partial with the pruned subset
 * → diff. `subset` is the candidate list the spec derived from the dirty
 * rects; the caller decides which items to include (the production query
 * would include ancestors and compositing dependencies — the spec models
 * those by adding the extra items explicitly).
 */
async function runOracle(
  page: import('@playwright/test').Page,
  fullItems: RenderItem[],
  dirtyRects: DirtyRect[],
  subset: RenderItem[],
): Promise<{ diffPixels: number; maxDelta: number; total: number }> {
  await renderFull(page, fullItems);
  await page.evaluate(() =>
    (window as unknown as { __capturePixels: () => number }).__capturePixels(),
  );
  await renderPartial(page, subset, dirtyRects);
  return page.evaluate(() =>
    (
      window as unknown as {
        __diffPixels: () => { diffPixels: number; maxDelta: number; total: number };
      }
    ).__diffPixels(),
  );
}

test.describe('partial redraw oracle', () => {
  test('localized move: pruned subset + multi-rect clip equals the full render', async ({
    page,
  }) => {
    await openHarness(page);
    const grid = gridScene();
    // AFTER the move: the node at (20, 20) now sits at (30, 25).
    const after = grid.map((item) =>
      item.primitive.kind === 'rect' && item.transform[4] === 20 && item.transform[5] === 20
        ? rectItem(30, 25, 40, 40)
        : item,
    );
    const dirtyRects: DirtyRect[] = [
      { x: 20, y: 20, w: 40, h: 40 },
      { x: 30, y: 25, w: 40, h: 40 },
    ];
    const subset = after.filter((item) => intersects(rectBounds(item), dirtyRects));
    // The moved node is a candidate; the grid is sparse so nothing else
    // touches the two rects.
    expect(subset.length).toBeGreaterThanOrEqual(1);
    expect(subset.length).toBeLessThan(after.length);

    const result = await runOracle(page, after, dirtyRects, subset);
    expect(result.diffPixels, JSON.stringify(result)).toBe(0);
  });

  test('distant invalidations with a node spanning both rects', async ({ page }) => {
    await openHarness(page);
    const scene = gridScene();
    // A long node spanning two distant dirty rects (moved 6 px each way).
    const spanning = rectItem(20, 160, 340, 40, { fill: RED });
    scene.push(spanning);
    const dirtyRects: DirtyRect[] = [
      { x: 20, y: 160, w: 40, h: 40 },
      { x: 300, y: 160, w: 40, h: 40 },
    ];
    const subset = scene.filter((item) => intersects(rectBounds(item), dirtyRects));
    // The spanning node must be included (it touches both rects); most grid
    // cells are pruned.
    expect(subset).toContain(spanning);
    expect(subset.length).toBeLessThan(scene.length);

    const result = await runOracle(page, scene, dirtyRects, subset);
    expect(result.diffPixels, JSON.stringify(result)).toBe(0);
  });

  test('translucent overlap: both layers included, backdrop preserved', async ({ page }) => {
    await openHarness(page);
    const scene = gridScene();
    // A translucent blue rect dragged over a teal one: old and new bounds.
    const translucent = rectItem(20, 20, 40, 40, {
      fill: BLUE,
      opacity: 0.5,
      transform: [1, 0, 0, 1, 40, 30],
    });
    scene.push(translucent);
    const dirtyRects: DirtyRect[] = [
      { x: 20, y: 20, w: 40, h: 40 },
      { x: 40, y: 30, w: 40, h: 40 },
    ];
    const subset = scene.filter((item) => intersects(rectBounds(item), dirtyRects));
    expect(subset).toContain(translucent);
    // The backdrop rect under the translucent node must be in the subset.
    expect(subset.length).toBeGreaterThan(1);

    const result = await runOracle(page, scene, dirtyRects, subset);
    expect(result.diffPixels, JSON.stringify(result)).toBe(0);
  });

  test('two distant rects must not clear or repaint the gap between them', async ({ page }) => {
    await openHarness(page);
    const scene = gridScene();
    // Two separate edits far apart; the gap contains a grid node that is NOT
    // part of the change and must keep its retained pixels.
    const dirtyRects: DirtyRect[] = [
      { x: 20, y: 20, w: 40, h: 40 },
      { x: 300, y: 300, w: 40, h: 40 },
    ];
    const subset = scene.filter((item) => intersects(rectBounds(item), dirtyRects));
    expect(subset.length).toBeLessThan(scene.length);
    // A gap node must NOT be in the subset.
    const gapNode = scene.find((item) => rectBounds(item).x === 90 && rectBounds(item).y === 20);
    expect(gapNode).toBeDefined();
    expect(subset).not.toContain(gapNode);

    const result = await runOracle(page, scene, dirtyRects, subset);
    expect(result.diffPixels, JSON.stringify(result)).toBe(0);
  });

  test('missing a candidate produces a detectable diff (oracle sensitivity)', async ({ page }) => {
    await openHarness(page);
    const scene = gridScene();
    const dirtyRects: DirtyRect[] = [{ x: 20, y: 20, w: 40, h: 40 }];
    const subset = scene.filter((item) => intersects(rectBounds(item), dirtyRects));
    // Deliberately drop one candidate — the oracle must catch it.
    const result = await runOracle(page, scene, dirtyRects, subset.slice(1));
    expect(result.diffPixels, JSON.stringify(result)).toBeGreaterThan(0);
  });

  /**
   * Scrolling. A camera translation moves every painted pixel, so retained
   * backing-store pixels are wrong the moment the camera moves — including
   * the common case where the camera and the document change in the SAME
   * frame (auto-pan while dragging a node toward the viewport edge).
   *
   * These two tests pin both halves of the contract that
   * `surfaceMatchesBackingStore` enforces in production: a partial redraw
   * across a pan is visibly wrong, and the full-redraw fallback it forces is
   * correct.
   */
  test('partial redraw across a pan leaves stale pixels (why the camera gate exists)', async ({
    page,
  }) => {
    await openHarness(page);
    const PAN_X = 24;
    const PAN_Y = 16;
    const before = gridScene();
    // The camera scrolled by (PAN_X, PAN_Y) and one node moved in the same
    // frame — every node lands somewhere new, not just the edited one.
    const after = before.map((item) => {
      const b = rectBounds(item);
      const moved = b.x === 20 && b.y === 20;
      return rectItem(b.x + PAN_X + (moved ? 10 : 0), b.y + PAN_Y + (moved ? 5 : 0), 40, 40);
    });
    // The dirty region the document diff produces: only the edited node's old
    // and new bounds. It knows nothing about the camera.
    const dirtyRects: DirtyRect[] = [
      { x: 20, y: 20, w: 40, h: 40 },
      { x: 20 + PAN_X + 10, y: 20 + PAN_Y + 5, w: 40, h: 40 },
    ];
    const subset = after.filter((item) => intersects(rectBounds(item), dirtyRects));

    // Reference: what the frame must look like — a full redraw after the pan.
    await renderFull(page, after);
    await page.evaluate(() =>
      (window as unknown as { __capturePixels: () => number }).__capturePixels(),
    );
    // What partial redraw would produce: pre-pan pixels retained outside the
    // dirty rects, freshly-panned content painted inside them.
    await renderFull(page, before);
    await renderPartial(page, subset, dirtyRects);
    const result = await page.evaluate(() =>
      (
        window as unknown as {
          __diffPixels: () => { diffPixels: number; maxDelta: number; total: number };
        }
      ).__diffPixels(),
    );

    // Every node outside the dirty rects is still drawn at the old scroll
    // offset: a large, obvious corruption, not a rounding artifact.
    expect(result.diffPixels, JSON.stringify(result)).toBeGreaterThan(1000);
  });

  test('full redraw after a pan matches the trusted render exactly', async ({ page }) => {
    await openHarness(page);
    const PAN_X = 24;
    const PAN_Y = 16;
    const before = gridScene();
    const after = before.map((item) => {
      const b = rectBounds(item);
      return rectItem(b.x + PAN_X, b.y + PAN_Y, 40, 40);
    });

    await renderFull(page, after);
    await page.evaluate(() =>
      (window as unknown as { __capturePixels: () => number }).__capturePixels(),
    );
    // Simulate the production fallback: stale surface, then a full repaint.
    await renderFull(page, before);
    await renderFull(page, after);
    const result = await page.evaluate(() =>
      (
        window as unknown as {
          __diffPixels: () => { diffPixels: number; maxDelta: number; total: number };
        }
      ).__diffPixels(),
    );

    expect(result.diffPixels, JSON.stringify(result)).toBe(0);
  });
});
