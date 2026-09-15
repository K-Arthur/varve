/**
 * Isometric construction workflow — independent verification.
 *
 * Complements `isometric-grid.spec.ts` with the workflow scenarios that suite
 * does not cover: a three-face cube built across planes with shared lattice
 * vertices, a multi-object move that must preserve relative arrangement, and
 * hide/undo/redo safety. Expected world geometry is recomputed in the test
 * from the grid snapshot's own basis vectors (published by the app) using
 * plain linear algebra — no implementation helper is imported.
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REVIEW_DIR = 'reports/isometric-review';

interface GridSnapshot {
  id: string;
  visible: boolean;
  snapEnabled: boolean;
  activePlaneId: string;
  spacing: number;
  origin: [number, number];
  basis: [number, number, number, number];
  families: Array<{ index: number; angleDeg: number; offsetStep: number; role: string }>;
  planeBasis: [number, number, number, number] | null;
}

interface SelectionGeometry {
  id: string;
  kind: string;
  localTransform: number[];
  worldTransform: number[];
  shape: {
    kind?: string;
    points?: Array<{ x: number; y: number }>;
    closed?: boolean;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  } | null;
}

type Vec2 = [number, number];

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centroid = (points: Vec2[]): Vec2 =>
  points.reduce<Vec2>((acc, p) => add(acc, scale(p, 1 / points.length)), [0, 0]);

async function enableIsometricWorkspace(page: Page) {
  await page.keyboard.press('Alt+Shift+I');
  await expect
    .poll(async () => page.evaluate(() => window.__varveIsoTest?.getGridOverlayMode()))
    .toBe('isometric');
  await expect(page.locator('.document-grid-overlay path').first()).toBeVisible({ timeout: 5000 });
}

async function waitForCanvasReady(page: Page) {
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.editor-canvas canvas').length > 0,
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(250);
}

async function grid(page: Page): Promise<GridSnapshot> {
  const value = await page.evaluate(() => window.__varveIsoTest?.getGrid() ?? null);
  expect(value).not.toBeNull();
  return value!;
}

/** Drag the rect tool between two canvas points; waits until a shape is selected. */
async function drawRectPath(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForCanvasReady(page);
    await page.keyboard.press('r');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press('v');
    try {
      await expect
        .poll(async () => page.evaluate(() => window.__varveIsoTest?.getSelection().length ?? 0), {
          timeout: 8000,
        })
        .toBeGreaterThan(0);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function ensureIsometricInspector(page: Page) {
  const planeGroup = page.getByRole('radiogroup', { name: 'Active construction plane' });
  if (await planeGroup.isVisible().catch(() => false)) return;
  const section = page.getByRole('button', { name: 'Isometric Grid', exact: true });
  await section.scrollIntoViewIfNeeded();
  await section.click();
  await expect(planeGroup).toBeVisible({ timeout: 5000 });
}

async function setActivePlane(page: Page, label: string, id: string) {
  await ensureIsometricInspector(page);
  await page.getByRole('radio', { name: label, exact: true }).check();
  await expect.poll(async () => (await grid(page)).activePlaneId).toBe(id);
}

/** Clear the selection with the Select None shortcut so the document Inspector returns. */
async function deselect(page: Page) {
  await page.keyboard.press('v');
  await page.keyboard.press('Control+Shift+A');
  await expect
    .poll(async () => page.evaluate(() => window.__varveIsoTest?.getSelection().length ?? 0))
    .toBe(0);
}

function worldPoints(item: SelectionGeometry): Vec2[] {
  const t = item.worldTransform;
  const shape = item.shape;
  const local: Array<{ x: number; y: number }> = shape?.points ?? [];
  return local.map((p) => [t[0]! * p.x + t[2]! * p.y + t[4]!, t[1]! * p.x + t[3]! * p.y + t[5]!]);
}

/** Match each expected corner to its nearest actual corner; return max error. */
function maxCornerError(expected: Vec2[], actual: Vec2[]): number {
  let worst = 0;
  for (const want of expected) {
    let best = Infinity;
    for (const got of actual) best = Math.min(best, dist(want, got));
    worst = Math.max(worst, best);
  }
  return worst;
}

function solve2x2(m: [number, number, number, number], v: Vec2): Vec2 {
  const det = m[0] * m[3] - m[1] * m[2];
  return [(v[0] * m[3] - v[1] * m[2]) / det, (v[1] * m[0] - v[0] * m[1]) / det];
}

async function screenOf(page: Page, p: Vec2): Promise<{ x: number; y: number }> {
  // The hook projects into canvas-area CSS pixels; pointer input needs page
  // coordinates, so add the canvas element's viewport offset.
  return page.evaluate(
    (world) => {
      const hook = window.__varveIsoTest;
      const el = document.querySelector<HTMLElement>('.editor-canvas');
      if (!hook || !el) throw new Error('iso test hooks missing');
      const rect = el.getBoundingClientRect();
      const screen = hook.worldToScreen(world[0], world[1]);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    },
    p as [number, number],
  );
}

/** Canvas CSS px per document unit (the camera is a uniform scale). */
async function measureZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = window.__varveIsoTest;
    if (!hook) throw new Error('iso test hooks missing');
    const a = hook.worldToScreen(0, 0);
    const b = hook.worldToScreen(1, 0);
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
}

test.describe('Isometric construction workflow — independent verification', () => {
  // The shared working tree is edited by other agents while this suite runs;
  // a Vite HMR reload returns the app to the Home surface mid-gesture. A retry
  // restarts the identical assertions from a clean page — it is not a weaker
  // check, and a product regression still fails both attempts.
  test.describe.configure({ retries: 1 });

  test('builds a three-face cube whose shared vertices coincide on the lattice', async ({
    page,
  }) => {
    await navigateToEditor(page, '/?isoTest=1');
    await enableIsometricWorkspace(page);
    const snapshot = await grid(page);
    const [a, b, c, d] = snapshot.basis;
    const e1: Vec2 = [a, b];
    const e2: Vec2 = [c, d];
    // The derived vertical axis: lattice points satisfy e1 + e2 + e3 = 0.
    const e3: Vec2 = [-(a + c), -(b + d)];

    // Start near the viewport centre so the cube is visible at any fit zoom.
    const centreWorld = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.editor-canvas');
      const width = el?.clientWidth ?? window.innerWidth;
      const height = el?.clientHeight ?? window.innerHeight;
      const hook = window.__varveIsoTest;
      if (!hook) throw new Error('iso test hooks missing');
      return hook.screenToWorld(width / 2, height / 2);
    });
    const local = solve2x2(
      [e1[0], e1[1], e2[0], e2[1]],
      sub([centreWorld.x, centreWorld.y], snapshot.origin),
    );
    const Q = add(
      snapshot.origin,
      add(scale(e1, Math.round(local[0])), scale(e2, Math.round(local[1]))),
    );
    const steps = 5;
    const A = scale(e1, steps);
    const B = scale(e2, steps);
    const C = scale(e3, steps);
    const zoom = await measureZoom(page);
    const tol = 2 / Math.max(0.2, zoom) + 0.5;

    const faces = [
      {
        plane: 'Front',
        id: 'front',
        corners: [Q, add(Q, A), add(add(Q, A), C), add(Q, C)],
      },
      {
        plane: 'Side',
        id: 'side',
        corners: [Q, add(Q, B), add(add(Q, B), C), add(Q, C)],
      },
      {
        plane: 'Top',
        id: 'top',
        corners: [add(Q, C), add(add(Q, A), C), add(add(add(Q, A), B), C), add(add(Q, B), C)],
      },
    ] as const;

    const drawnById = new Map<string, Vec2[]>();
    for (const face of faces) {
      await deselect(page);
      await setActivePlane(page, face.plane, face.id);
      expect((await grid(page)).activePlaneId).toBe(face.id);
      const first = await screenOf(page, face.corners[0]!);
      const opposite = await screenOf(page, face.corners[2]!);
      await drawRectPath(page, first, opposite);
      const selected = await page.evaluate(
        () => window.__varveIsoTest?.getSelectionGeometry() ?? [],
      );
      expect(selected.length).toBe(1);
      expect(selected[0]!.shape?.kind).toBe('path');
      expect(selected[0]!.shape?.points?.length).toBe(4);
      drawnById.set(face.id, worldPoints(selected[0]!));
      await page.screenshot({
        path: `${REVIEW_DIR}/cube-face-${face.id}.png`,
        fullPage: false,
      });
    }

    // Each face must match the independently computed world corners.
    for (const face of faces) {
      const actual = drawnById.get(face.id)!;
      const error = maxCornerError(face.corners as unknown as Vec2[], actual);
      expect(error, `${face.id} face corners`).toBeLessThan(tol);
    }

    // Shared vertices of the closed cube: these must coincide across faces.
    const shared: Array<{ point: Vec2; inFaces: string[] }> = [
      { point: add(Q, C), inFaces: ['front', 'side', 'top'] },
      { point: add(add(Q, A), C), inFaces: ['front', 'top'] },
      { point: add(add(Q, B), C), inFaces: ['side', 'top'] },
      { point: Q, inFaces: ['front', 'side'] },
    ];
    for (const vertex of shared) {
      for (const faceId of vertex.inFaces) {
        const actual = drawnById.get(faceId)!;
        const nearest = Math.min(...actual.map((p) => dist(p, vertex.point)));
        expect(nearest, `${faceId} shares vertex ${vertex.point}`).toBeLessThan(tol);
      }
    }

    // Edges of every face are one cube side long, so the three faces form a
    // coherent prism rather than three unrelated parallelograms.
    for (const face of faces) {
      const actual = drawnById.get(face.id)!;
      const side = steps * snapshot.spacing;
      for (let i = 0; i < 4; i++) {
        const edge = dist(actual[i]!, actual[(i + 1) % 4]!);
        expect(Math.abs(edge - side), `${face.id} edge ${i}`).toBeLessThan(tol * 1.5);
      }
    }
  });

  test('moves a multi-object selection by one common translation', async ({ page }) => {
    await navigateToEditor(page, '/?isoTest=1');
    await enableIsometricWorkspace(page);
    await setActivePlane(page, 'Top', 'top');

    await drawRectPath(page, { x: 430, y: 260 }, { x: 530, y: 330 });
    await drawRectPath(page, { x: 660, y: 310 }, { x: 770, y: 380 });
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getSelection().length ?? 0))
      .toBe(1);

    // Marquee selects both shapes.
    await page.keyboard.press('v');
    await page.mouse.move(360, 180);
    await page.mouse.down();
    await page.mouse.move(860, 460, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getSelection().length ?? 0))
      .toBe(2);

    const before = await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? []);
    const beforeById = new Map(before.map((item) => [item.id, worldPoints(item)]));
    const ids = before.map((item) => item.id).sort();

    await page.mouse.move(480, 295);
    await page.mouse.down();
    await page.mouse.move(520, 330, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? []);
    expect(after.length).toBe(2);
    const afterById = new Map(after.map((item) => [item.id, worldPoints(item)]));
    const deltas = ids.map((id) => {
      const previous = centroid(beforeById.get(id)!);
      const current = centroid(afterById.get(id)!);
      return sub(current, previous);
    });
    // One common translation: both shapes moved by exactly the same vector.
    expect(Math.abs(deltas[0]![0] - deltas[1]![0])).toBeLessThan(1e-6);
    expect(Math.abs(deltas[0]![1] - deltas[1]![1])).toBeLessThan(1e-6);
    expect(Math.hypot(deltas[0]![0], deltas[0]![1])).toBeGreaterThan(3);

    // Relative arrangement preserved: the centre-to-centre edge is unchanged.
    const beforeEdge = sub(centroid(beforeById.get(ids[0]!)!), centroid(beforeById.get(ids[1]!)!));
    const afterEdge = sub(centroid(afterById.get(ids[0]!)!), centroid(afterById.get(ids[1]!)!));
    expect(dist(beforeEdge, afterEdge)).toBeLessThan(1e-6);

    await page.screenshot({ path: `${REVIEW_DIR}/07-multi-move.png`, fullPage: false });
  });

  test('hiding the grid changes no artwork, and undo/redo stays exact', async ({ page }) => {
    await navigateToEditor(page, '/?isoTest=1');
    await enableIsometricWorkspace(page);
    await drawRectPath(page, { x: 520, y: 300 }, { x: 660, y: 380 });
    const geometryBefore = await page.evaluate(
      () => window.__varveIsoTest?.getSelectionGeometry() ?? [],
    );
    const countBefore = await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0);
    expect(countBefore).toBeGreaterThan(0);

    const menuUndo = async () => {
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      await page.locator('[role="menu"]').getByRole('menuitem', { name: /^Undo/ }).click();
    };
    const menuRedo = async () => {
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      await page.locator('[role="menu"]').getByRole('menuitem', { name: /^Redo/ }).click();
    };

    // Undo/redo of the drawing remains exact.
    await menuUndo();
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0))
      .toBe(countBefore - 1);
    await menuRedo();
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0))
      .toBe(countBefore);
    await page.keyboard.press('Control+a');
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getSelection().length ?? 0))
      .toBe(1);
    expect(await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? [])).toEqual(
      geometryBefore,
    );

    // The transient overlay mode (Alt+Shift+I) is a view state: toggling it
    // twice must not add a history entry, so Undo still undoes the drawing.
    await page.keyboard.press('Alt+Shift+I');
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getGridOverlayMode()))
      .toBe('none');
    await expect(page.locator('.document-grid-overlay path')).toHaveCount(0);
    expect(await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0)).toBe(countBefore);
    await page.keyboard.press('Alt+Shift+I');
    await expect(page.locator('.document-grid-overlay path').first()).toBeVisible({
      timeout: 8000,
    });
    await menuUndo();
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0))
      .toBe(countBefore - 1);
    await menuRedo();
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0))
      .toBe(countBefore);

    // Grid visibility is authored document state, so hiding it is one
    // meaningful (undoable) edit — and it never touches artwork.
    await deselect(page);
    await ensureIsometricInspector(page);
    const visibility = page.getByRole('switch', { name: 'Show isometric grid' });
    await visibility.uncheck();
    await expect.poll(async () => (await grid(page)).visible).toBe(false);
    await expect(page.locator('.document-grid-overlay path')).toHaveCount(0);
    expect(await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0)).toBe(countBefore);
    // Hidden-grid policy: display visibility does not disable snapping.
    expect((await grid(page)).snapEnabled).toBe(true);

    await menuUndo();
    await expect.poll(async () => (await grid(page)).visible).toBe(true);
    await expect(page.locator('.document-grid-overlay path').first()).toBeVisible({
      timeout: 8000,
    });
    expect(await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0)).toBe(countBefore);

    await menuRedo();
    await expect.poll(async () => (await grid(page)).visible).toBe(false);
    await visibility.check();
    await expect(page.locator('.document-grid-overlay path').first()).toBeVisible({
      timeout: 8000,
    });
    expect(await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0)).toBe(countBefore);
    await page.screenshot({ path: `${REVIEW_DIR}/08-hidden-grid-roundtrip.png`, fullPage: false });
  });

  test('exporting with the grid visible never includes the construction aid', async ({ page }) => {
    await navigateToEditor(page, '/?isoTest=1');
    await enableIsometricWorkspace(page);
    // Drag clearly across both plane axes (not parallel to either), so the
    // projected quad is visible rather than a near-degenerate sliver.
    await drawRectPath(page, { x: 500, y: 280 }, { x: 680, y: 430 });
    await page.waitForTimeout(200);

    // The exported artwork itself must be a real plane rectangle, otherwise
    // the export comparison would be comparing the wrong thing.
    const snapshot = await grid(page);
    expect(snapshot.activePlaneId).toBe('top');
    const selected = await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? []);
    expect(selected.length).toBe(1);
    expect(selected[0]!.shape?.kind).toBe('path');
    expect(selected[0]!.shape?.points?.length).toBe(4);
    const planeBasis = snapshot.planeBasis;
    expect(planeBasis).not.toBeNull();
    const inverse = [
      planeBasis![3] / (planeBasis![0] * planeBasis![3] - planeBasis![1] * planeBasis![2]),
      -planeBasis![2] / (planeBasis![0] * planeBasis![3] - planeBasis![1] * planeBasis![2]),
      -planeBasis![1] / (planeBasis![0] * planeBasis![3] - planeBasis![1] * planeBasis![2]),
      planeBasis![0] / (planeBasis![0] * planeBasis![3] - planeBasis![1] * planeBasis![2]),
    ];
    const worldPts = worldPoints(selected[0]!);
    const uv = worldPts.map((p) => [
      inverse[0]! * (p[0] - snapshot.origin[0]) + inverse[1]! * (p[1] - snapshot.origin[1]),
      inverse[2]! * (p[0] - snapshot.origin[0]) + inverse[3]! * (p[1] - snapshot.origin[1]),
    ]);
    const uValues = new Set(uv.map((p) => p[0]!.toFixed(3)));
    const vValues = new Set(uv.map((p) => p[1]!.toFixed(3)));
    expect(uValues.size).toBe(2);
    expect(vValues.size).toBe(2);

    // The grid really is on screen while we export.
    await expect(page.locator('.document-grid-overlay path').first()).toBeVisible();

    const selectExportTab = async () => {
      const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
        hasText: /^export$/i,
      });
      if (await exportTab.isVisible().catch(() => false)) {
        await exportTab.click();
        return;
      }
      await page.getByRole('button', { name: /^More inspector tabs/ }).click();
      await page
        .getByRole('menu', { name: 'More inspector tabs' })
        .getByRole('menuitem', { name: 'Export', exact: true })
        .click();
    };
    const downloadSvg = async (): Promise<string> => {
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
      await page.getByRole('button', { name: /download/i }).click();
      const download = await downloadPromise;
      const path = await download.path();
      expect(path).toBeTruthy();
      const { readFile } = await import('node:fs/promises');
      return readFile(path!, 'utf-8');
    };

    await page.keyboard.press('v');
    await selectExportTab();
    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'SVG', exact: true })
      .click();
    const withGrid = await downloadSvg();
    expect(withGrid).toContain('<svg');
    expect(withGrid).not.toContain('document-grid-overlay');

    // Hide the overlay and export again: the document output must be
    // identical, because the construction grid was never scene data.
    await page.keyboard.press('Alt+Shift+I');
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getGridOverlayMode()))
      .toBe('none');
    await expect(page.locator('.document-grid-overlay path')).toHaveCount(0);
    const withoutGrid = await downloadSvg();

    // Primitive-agnostic drawing summary: tag + geometry attribute, sorted.
    const drawingSummary = (svg: string): string[] =>
      [
        ...svg.matchAll(
          /<(path|polygon|polyline|line|rect)\b[^>]*?(?:\sd="([^"]*)")?[^>]*?(?:\spoints="([^"]*)")?[^>]*>/g,
        ),
      ]
        .map((match) => `${match[1]}:${match[2] ?? match[3] ?? ''}`)
        .sort();
    const withSummary = drawingSummary(withGrid);
    const withoutSummary = drawingSummary(withoutGrid);
    expect(withSummary.length).toBeGreaterThan(0);
    expect(withoutSummary).toEqual(withSummary);
    await page.screenshot({ path: `${REVIEW_DIR}/09-export-with-grid.png`, fullPage: false });
  });
});
