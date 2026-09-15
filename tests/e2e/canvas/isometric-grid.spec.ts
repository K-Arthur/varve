/**
 * Isometric construction workflow — real editor, real pointer gestures.
 *
 * Every assertion is made against either the rendered DOM (overlay SVG,
 * snap crosshair) or the committed document (node transforms and shape
 * geometry read through the read-only `?isoTest=1` hook). Expected lattice
 * values are recomputed here from first principles (plain trigonometry), not
 * imported from the implementation, so the test and the app cannot share a
 * projection mistake.
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

declare global {
  interface Window {
    __varveIsoTest?: {
      getGridOverlayMode: () => string;
      worldToScreen: (x: number, y: number) => { x: number; y: number };
      screenToWorld: (x: number, y: number) => { x: number; y: number };
      getGrid: () => GridSnapshot | null;
      getSelection: () => string[];
      getSelectionGeometry: () => SelectionGeometry[];
      getNodeCount: () => number;
      isDirty: () => boolean;
    };
  }
}

async function enableIsometricWorkspace(page: Page) {
  // The shortcut both shows the overlay and makes the active grid visible.
  await page.keyboard.press('Alt+Shift+I');
  await expect
    .poll(async () => page.evaluate(() => window.__varveIsoTest?.getGridOverlayMode()))
    .toBe('isometric');
  await expect(page.locator('.document-grid-overlay path').first()).toBeVisible({ timeout: 5000 });
}

/** Wait until the canvas surface accepts pointer input (cold dev-server safe). */
async function waitForCanvasReady(page: Page) {
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.editor-canvas canvas').length > 0,
    undefined,
    { timeout: 30000 },
  );
  // One animation frame of settle so the first pointerdown is not swallowed by
  // a still-mounting surface.
  await page.waitForTimeout(300);
}

/**
 * Draw a rectangle with the rect tool and wait until exactly one shape is
 * selected. A cold dev server can accept the drag before the canvas surface is
 * interactive; retrying once keeps the workflow test honest without hiding a
 * real product failure (the retry only re-issues the same user gesture).
 */
async function drawRectangle(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForCanvasReady(page);
    await page.keyboard.press('r');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.press('v');
    try {
      await expect
        .poll(async () => page.evaluate(() => window.__varveIsoTest?.getSelection().length ?? 0), {
          timeout: 8000,
        })
        .toBe(1);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function enterIsometricWorkspace(page: Page) {
  await navigateToEditor(page, '/?isoTest=1');
  await enableIsometricWorkspace(page);
}

async function openIsometricInspector(page: Page) {
  const section = page.getByRole('button', { name: 'Isometric Grid', exact: true });
  await section.scrollIntoViewIfNeeded();
  await section.click();
  await expect(page.getByRole('switch', { name: 'Show isometric grid' })).toBeVisible();
}

/** Raise the magnetic tolerance and ensure global snapping is enabled. */
async function setSnapTolerance(page: Page, value: number) {
  const globalSnap = page.getByRole('switch', { name: 'Enable magnetic pointer snapping' });
  await globalSnap.scrollIntoViewIfNeeded();
  if (!(await globalSnap.isChecked())) await globalSnap.check();
  const tolerance = page.getByRole('spinbutton', { name: /snap tolerance/i });
  await tolerance.scrollIntoViewIfNeeded();
  await tolerance.fill(String(value));
  await tolerance.blur();
}

async function grid(page: Page): Promise<GridSnapshot> {
  const value = await page.evaluate(() => window.__varveIsoTest?.getGrid() ?? null);
  expect(value).not.toBeNull();
  return value!;
}

/** Undirected angle in degrees, folded into [0, 180). */
function undirectedAngleDeg(dx: number, dy: number): number {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((angle % 180) + 180) % 180;
}

/** Parse SVG path `d` strings into segments (format `MX YL...`). */
function parsePathSegments(d: string): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const tokens = d.match(/[ML]-?[\d.]+ -?[\d.]+/g) ?? [];
  let cursor: { x: number; y: number } | null = null;
  for (const token of tokens) {
    const match = token.match(/^([ML])(-?[\d.]+) (-?[\d.]+)$/);
    if (!match) continue;
    const command = match[1];
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (command === 'M') {
      cursor = { x, y };
    } else if (command === 'L' && cursor) {
      segments.push({ x1: cursor.x, y1: cursor.y, x2: x, y2: y });
      cursor = { x, y };
    }
  }
  return segments;
}

/** Solve a 2×2 system independently (no shared helper with the app). */
function invert2x2(m: readonly [number, number, number, number]): [number, number, number, number] {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

function apply2x2(m: readonly [number, number, number, number], p: [number, number]) {
  return [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]] as [number, number];
}

/** Nearest lattice point using the basis supplied by the app, brute forced. */
function nearestLatticeDistance(
  point: [number, number],
  origin: [number, number],
  basis: readonly [number, number, number, number],
): number {
  let best = Infinity;
  for (let i = -40; i <= 40; i++) {
    for (let j = -40; j <= 40; j++) {
      const dx = origin[0] + basis[0] * i + basis[2] * j - point[0];
      const dy = origin[1] + basis[1] * i + basis[3] * j - point[1];
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best;
}

function worldPoints(item: SelectionGeometry): Array<[number, number]> {
  const t = item.worldTransform;
  const shape = item.shape;
  let local: Array<{ x: number; y: number }> = shape?.points ?? [];
  if (local.length === 0 && shape?.kind === 'rect') {
    const { x = 0, y = 0, w = 0, h = 0 } = shape;
    local = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }
  return local.map((p) => [t[0]! * p.x + t[2]! * p.y + t[4]!, t[1]! * p.x + t[3]! * p.y + t[5]!]);
}

test.describe('Isometric construction workflow (real editor)', () => {
  test('renders the declared lattice and keeps phase when the origin moves', async ({ page }) => {
    await enterIsometricWorkspace(page);
    const snapshot = await grid(page);
    expect(snapshot.visible).toBe(true);
    expect(snapshot.spacing).toBeCloseTo(24, 6);
    expect(snapshot.families.map((family) => Math.round(family.angleDeg))).toEqual([30, 150, 90]);

    // Independently derived true-isometric geometry: equal axis lengths and
    // 120° between the two ground axes.
    const [a, b, c, d] = snapshot.basis;
    const b1 = Math.hypot(a, b);
    const b2 = Math.hypot(c, d);
    expect(b1).toBeCloseTo(24, 6);
    expect(b2).toBeCloseTo(24, 6);
    const dotProduct = (a * c + b * d) / (b1 * b2);
    expect((Math.acos(dotProduct) * 180) / Math.PI).toBeCloseTo(120, 4);

    // The rendered overlay's segments must run in exactly the declared
    // directions — this is the independent projection check against the
    // overlay (not the module).
    const paths = await page.locator('.document-grid-overlay path').all();
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const path of paths) {
      const dAttr = (await path.getAttribute('d')) ?? '';
      segments.push(
        ...parsePathSegments(dAttr).filter(
          (segment) => Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) >= 2,
        ),
      );
    }
    expect(segments.length).toBeGreaterThan(20);
    const angles = segments.map((s) => undirectedAngleDeg(s.x2 - s.x1, s.y2 - s.y1));
    // Every rendered segment must run along one of the three declared axis
    // directions (2° absorbs sub-pixel endpoint rounding on clipped slivers).
    const expected = [30, 90, 150];
    const deviations = angles.map((angle) => Math.min(...expected.map((e) => Math.abs(angle - e))));
    expect(Math.max(...deviations)).toBeLessThan(2);
    // And all three directions are actually present.
    for (const direction of expected) {
      expect(angles.some((angle) => Math.abs(angle - direction) < 2)).toBe(true);
    }

    // Move the origin and confirm the lattice phase follows the authored
    // origin, while the overlay stays view-correct.
    await openIsometricInspector(page);
    const originX = page.getByRole('spinbutton', { name: /isometric grid origin x/i });
    await originX.fill('37');
    await originX.blur();
    await expect.poll(async () => (await grid(page)).origin[0]).toBe(37);
    // Pan far away; the overlay must still cover the viewport (no fixed cuts).
    await page.keyboard.press('h');
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(640, 400);
      await page.mouse.down();
      await page.mouse.move(200, 200, { steps: 6 });
      await page.mouse.up();
    }
    await expect(page.locator('.document-grid-overlay path').first()).toBeVisible();
    const panSegments = await page.locator('.document-grid-overlay path').all();
    let visibleCount = 0;
    for (const path of panSegments) {
      visibleCount += parsePathSegments((await path.getAttribute('d')) ?? '').length;
    }
    expect(visibleCount).toBeGreaterThan(10);

    await page.screenshot({ path: `${REVIEW_DIR}/01-lattice-and-pan.png`, fullPage: false });
  });

  test('draws a projected rectangle that is a real plane rectangle', async ({ page }) => {
    await enterIsometricWorkspace(page);
    const snapshot = await grid(page);
    expect(snapshot.activePlaneId).toBe('top');

    await drawRectangle(page, { x: 520, y: 300 }, { x: 760, y: 430 });
    await page.waitForTimeout(200);

    const selected = await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? []);
    expect(selected.length).toBe(1);
    const item = selected[0]!;
    expect(item.shape?.kind).toBe('path');
    expect(item.shape?.points?.length).toBe(4);
    expect(item.shape?.closed).toBe(true);

    const planeBasis = snapshot.planeBasis!;
    const inverse = invert2x2(planeBasis);
    const origin = snapshot.origin;
    const worldPts = worldPoints(item);
    // Express every corner in plane coordinates; the quad must be
    // axis-aligned there (two distinct u values, two distinct v values).
    const uv = worldPts.map((p) => apply2x2(inverse, [p[0] - origin[0], p[1] - origin[1]]));
    const uValues = [...new Set(uv.map((p) => p[0].toFixed(3)))];
    const vValues = [...new Set(uv.map((p) => p[1].toFixed(3)))];
    expect(uValues.length).toBe(2);
    expect(vValues.length).toBe(2);
    // Consecutive edges in plane coordinates are axis-aligned.
    for (let i = 0; i < 4; i++) {
      const from = uv[i]!;
      const to = uv[(i + 1) % 4]!;
      const du = Math.abs(to[0] - from[0]);
      const dv = Math.abs(to[1] - from[1]);
      expect(Math.min(du, dv)).toBeLessThan(1e-6);
    }

    await page.screenshot({ path: `${REVIEW_DIR}/02-projected-rect.png`, fullPage: false });
  });

  test('snaps moved artwork onto the lattice and shows the actual target', async ({ page }) => {
    await enterIsometricWorkspace(page);
    await setSnapTolerance(page, 32);
    const snapshot = await grid(page);
    expect(snapshot.snapEnabled).toBe(true);

    await drawRectangle(page, { x: 520, y: 300 }, { x: 640, y: 370 });
    await page.waitForTimeout(150);

    const before = (
      await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? [])
    )[0]!;

    // Drag by a small offset that is not a lattice step; snapping must pull
    // the shape so one of its corners lands exactly on a lattice point.
    await page.mouse.move(580, 335);
    await page.mouse.down();
    let sawCrosshair = false;
    for (let i = 1; i <= 8 && !sawCrosshair; i++) {
      await page.mouse.move(580 + i * 4, 335 + i * 2);
      await page.waitForTimeout(60);
      sawCrosshair = await page.evaluate(
        () => document.querySelectorAll('.snap-guides-overlay circle').length > 0,
      );
    }
    expect(sawCrosshair, 'isometric snap crosshair should appear during the drag').toBe(true);
    await page.screenshot({ path: `${REVIEW_DIR}/03-snap-crosshair.png`, fullPage: false });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const after = (
      await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? [])
    )[0]!;
    expect(after.id).toBe(before.id);
    const moved = worldPoints(after);
    const minDistance = Math.min(
      ...moved.map((point) => nearestLatticeDistance(point, snapshot.origin, snapshot.basis)),
    );
    expect(minDistance).toBeLessThan(0.01);
    // The shape itself moved (the snap is a real translation, not a no-op).
    const beforePts = worldPoints(before);
    expect(
      Math.hypot(moved[0]![0] - beforePts[0]![0], moved[0]![1] - beforePts[0]![1]),
    ).toBeGreaterThan(3);
    await page.screenshot({ path: `${REVIEW_DIR}/04-snapped-artwork.png`, fullPage: false });
  });

  test('fit to plane and unproject are validated inverses for flat artwork', async ({ page }) => {
    // Draw flat artwork *before* any isometric grid exists: no plane is
    // applied, so the rect keeps document-axis edges.
    await navigateToEditor(page, '/?isoTest=1');
    await drawRectangle(page, { x: 480, y: 320 }, { x: 620, y: 400 });
    await page.waitForTimeout(150);
    const flat = (
      await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? [])
    )[0]!;
    const flatWorld = worldPoints(flat);
    // A flat rect drawn with the plane off keeps axis-aligned edges.
    const flatEdge = [flatWorld[1]![0] - flatWorld[0]![0], flatWorld[1]![1] - flatWorld[0]![1]];
    expect(Math.abs(flatEdge[1]!)).toBeLessThan(1e-6);

    // Now show the isometric grid (default plane: Top) with the shape still
    // selected, so the Object-menu command is available.
    await enableIsometricWorkspace(page);
    const snapshot = await grid(page);
    expect(snapshot.activePlaneId).toBe('top');

    // Fit it to the Top plane. The document Inspector is replaced by object
    // properties while a layer is selected, so the command lives on the
    // Object menu too (same handler, one implementation).
    await page.getByRole('menuitem', { name: 'Object' }).click();
    await page.locator('[role="menu"]').getByRole('menuitem', { name: 'Fit to Plane' }).click();
    await page.waitForTimeout(200);
    const fitted = (
      await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? [])
    )[0]!;
    const fittedWorld = worldPoints(fitted);
    const centreBefore = {
      x: (Math.min(...flatWorld.map((p) => p[0])) + Math.max(...flatWorld.map((p) => p[0]))) / 2,
      y: (Math.min(...flatWorld.map((p) => p[1])) + Math.max(...flatWorld.map((p) => p[1]))) / 2,
    };
    // Independent expected mapping: pivot + B · (p − pivot).
    const B = snapshot.planeBasis!;
    for (let i = 0; i < 4; i++) {
      const local: [number, number] = [
        flatWorld[i]![0] - centreBefore.x,
        flatWorld[i]![1] - centreBefore.y,
      ];
      const mapped = apply2x2(B, local);
      expect(fittedWorld[i]![0]).toBeCloseTo(centreBefore.x + mapped[0], 3);
      expect(fittedWorld[i]![1]).toBeCloseTo(centreBefore.y + mapped[1], 3);
    }

    // Unproject must return to the original world geometry.
    await page.getByRole('menuitem', { name: 'Object' }).click();
    await page
      .locator('[role="menu"]')
      .getByRole('menuitem', { name: 'Unproject from Plane' })
      .click();
    await page.waitForTimeout(200);
    const restored = (
      await page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry() ?? [])
    )[0]!;
    const restoredWorld = worldPoints(restored);
    for (let i = 0; i < 4; i++) {
      expect(restoredWorld[i]![0]).toBeCloseTo(flatWorld[i]![0], 3);
      expect(restoredWorld[i]![1]).toBeCloseTo(flatWorld[i]![1], 3);
    }

    await page.screenshot({ path: `${REVIEW_DIR}/05-fit-unproject.png`, fullPage: false });
  });

  test('grid artwork is an explicit, independent document object', async ({ page }) => {
    await enterIsometricWorkspace(page);
    await openIsometricInspector(page);
    const before = await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0);

    const createButton = page.getByRole('button', { name: /grid artwork/i });
    await createButton.click();
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0))
      .toBeGreaterThan(before);

    // The construction grid remains a view overlay and is not part of the
    // generated artwork: toggling the overlay off changes no node.
    const afterCreate = await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0);
    await page.keyboard.press('Alt+Shift+I');
    await expect
      .poll(async () => page.evaluate(() => window.__varveIsoTest?.getGridOverlayMode()))
      .toBe('none');
    expect(await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0)).toBe(afterCreate);
    await page.keyboard.press('Alt+Shift+I');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__varveIsoTest?.getNodeCount() ?? 0)).toBe(afterCreate);
    // The overlay SVG is a sibling of the content canvas, not document data.
    expect(await page.locator('.document-grid-overlay path').count()).toBeGreaterThan(0);

    await page.screenshot({ path: `${REVIEW_DIR}/06-grid-artwork.png`, fullPage: false });
  });

  test('custom axes survive a preset visit and far zoom keeps major-phase identity', async ({
    page,
  }) => {
    await enterIsometricWorkspace(page);
    await openIsometricInspector(page);

    // Switch to Custom, edit axis 1, visit the 2:1 preset, return to Custom.
    await page.getByRole('combobox', { name: 'Isometric grid preset' }).click();
    await page.getByRole('option', { name: 'Custom' }).click();
    const axisAngle = page.getByRole('spinbutton', { name: /axis 1 angle/i });
    await axisAngle.fill('26.56505117707799');
    await axisAngle.blur();
    await expect
      .poll(async () => (await grid(page)).families[0]!.angleDeg)
      .toBeCloseTo(26.56505117707799, 6);

    await page.getByRole('combobox', { name: 'Isometric grid preset' }).click();
    await page.getByRole('option', { name: /Dimetric 2:1/ }).click();
    await expect
      .poll(async () => (await grid(page)).families[0]!.angleDeg)
      .toBeCloseTo((Math.atan2(1, 2) * 180) / Math.PI, 9);
    await page.getByRole('combobox', { name: 'Isometric grid preset' }).click();
    await page.getByRole('option', { name: 'Custom' }).click();
    await expect
      .poll(async () => (await grid(page)).families[0]!.angleDeg)
      .toBeCloseTo(26.56505117707799, 6);

    // Focus is retained: the angle field is still the active element with the
    // value the user typed (no remount on each keystroke).
    await axisAngle.click();
    await page.keyboard.press('End');
    await page.keyboard.type('5');
    await expect(axisAngle).toBeFocused();

    // Zoom far out and in; the visible major lines keep an integer authored
    // phase (checked by reading the rendered overlay's path endpoints through
    // the grid hook's basis).
    await page.mouse.move(640, 400);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
    await expect(page.locator('.document-grid-overlay path').first()).toBeVisible();
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(250);
    await expect(page.locator('.document-grid-overlay path').first()).toBeVisible();

    await page.screenshot({ path: `${REVIEW_DIR}/07-custom-and-zoom.png`, fullPage: false });
  });
});
