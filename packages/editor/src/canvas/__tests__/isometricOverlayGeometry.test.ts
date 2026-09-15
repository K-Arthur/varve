/**
 * Overlay geometry tests: the isometric overlay must project the canonical
 * lattice through the shared camera and stay correct under pan, zoom, camera
 * rotation, and display-density changes.
 *
 * The projection used to *check* the overlay is written out independently in
 * this file (matrix composition by hand) so a systematic convention error
 * cannot cancel itself out.
 */

import type { IsometricGrid } from '@varve/scene';
import { createDefaultIsometricGrid, resolveIsometricGeometry } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  computeIsometricOverlayLines,
  groupIsometricOverlayPaths,
} from '../isometricOverlayGeometry';

const viewport = { width: 800, height: 600 };

function grid(overrides: Partial<IsometricGrid> = {}): IsometricGrid {
  return { ...createDefaultIsometricGrid(), visible: true, ...overrides };
}

function geometryFor(value: IsometricGrid) {
  return resolveIsometricGeometry({
    originX: value.originX,
    originY: value.originY,
    spacing: value.spacing,
    rotation: value.rotation,
    axes: value.axes,
  })!;
}

/** Independent screen→world inverse of the documented camera convention. */
function unproject(
  camera: { zoom: number; pan: { x: number; y: number }; rotation: number },
  screen: readonly [number, number],
): [number, number] {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);
  const u = screen[0] - (cx + camera.pan.x);
  const v = screen[1] - (cy + camera.pan.y);
  const ru = u * cos - v * sin;
  const rv = u * sin + v * cos;
  return [(ru + cx) / camera.zoom, (rv + cy) / camera.zoom];
}

describe('isometric overlay geometry', () => {
  it('projects canonical lattice lines through the camera at rotation 0', () => {
    const camera = { zoom: 1.5, pan: { x: 30, y: -20 }, rotation: 0 };
    const value = grid({ originX: 40, originY: 60 });
    const result = computeIsometricOverlayLines({ grid: value, camera, viewport });
    expect(result.lines.length).toBeGreaterThan(10);

    const geometry = geometryFor(value);
    for (const line of result.lines) {
      const [wx1, wy1] = unproject(camera, [line.x1, line.y1]);
      const [wx2, wy2] = unproject(camera, [line.x2, line.y2]);
      // Both endpoints must lie on a line of the stated family: the
      // perpendicular offset from the grid origin is an integer multiple of
      // the family offset step.
      const family = geometry.families.find((candidate) => candidate.index === line.familyIndex)!;
      for (const [wx, wy] of [
        [wx1, wy1],
        [wx2, wy2],
      ] as const) {
        const offset =
          (wx - geometry.origin[0]) * family.normal[0] +
          (wy - geometry.origin[1]) * family.normal[1];
        const index = offset / family.offsetStep;
        expect(Math.abs(index - Math.round(index))).toBeLessThan(1e-6);
      }
    }
  });

  it('matches an independently composed camera projection under rotation', () => {
    const camera = { zoom: 2, pan: { x: -10, y: 25 }, rotation: Math.PI / 6 };
    const value = grid();
    const result = computeIsometricOverlayLines({ grid: value, camera, viewport });
    expect(result.lines.length).toBeGreaterThan(0);
    // Every screen endpoint is finite and inside the viewport (clipped world
    // box projected through the same camera can extend slightly beyond when
    // rotated, so allow a small margin).
    for (const line of result.lines) {
      for (const [x, y] of [
        [line.x1, line.y1],
        [line.x2, line.y2],
      ] as const) {
        expect(x).toBeGreaterThan(-2);
        expect(y).toBeGreaterThan(-2);
        expect(x).toBeLessThan(viewport.width + 2);
        expect(y).toBeLessThan(viewport.height + 2);
      }
    }
    // Full independent phase check under rotation: unproject every endpoint
    // with the hand-written inverse and confirm it lies on an integer line of
    // the stated family.
    const geometry = geometryFor(value);
    for (const line of result.lines) {
      const family = geometry.families.find((candidate) => candidate.index === line.familyIndex)!;
      for (const [x, y] of [
        [line.x1, line.y1],
        [line.x2, line.y2],
      ] as const) {
        const [wx, wy] = unproject(camera, [x, y]);
        const offset =
          (wx - geometry.origin[0]) * family.normal[0] +
          (wy - geometry.origin[1]) * family.normal[1];
        const index = offset / family.offsetStep;
        expect(Math.abs(index - Math.round(index))).toBeLessThan(1e-6);
      }
    }
  });

  it('flags the active plane families and marks a non-lattice third axis as a guide', () => {
    const active = computeIsometricOverlayLines({
      grid: grid(),
      camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
      viewport,
      activePlaneId: 'top',
    });
    const activeFamilies = new Set(
      active.lines.filter((line) => line.active).map((line) => line.familyIndex),
    );
    expect([...activeFamilies].sort()).toEqual([0, 1]);

    const guide = computeIsometricOverlayLines({
      grid: grid({
        axes: [
          { angle: 30, visible: true },
          { angle: 150, visible: true },
          { angle: 17, visible: true },
        ],
      }),
      camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
      viewport,
    });
    expect(guide.lines.some((line) => line.role === 'guide')).toBe(true);
  });

  it('omits a hidden axis from the rendered families', () => {
    const result = computeIsometricOverlayLines({
      grid: grid({
        axes: [
          { angle: 30, visible: true },
          { angle: 150, visible: true },
          { angle: 90, visible: false },
        ],
      }),
      camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
      viewport,
    });
    expect(result.lines.every((line) => line.familyIndex !== 2)).toBe(true);
  });

  it('reduces display density when zoomed out and never changes the phase', () => {
    const camera = { zoom: 0.05, pan: { x: 0, y: 0 }, rotation: 0 };
    const value = grid({ spacing: 24 });
    const result = computeIsometricOverlayLines({ grid: value, camera, viewport });
    expect(result.displayStep).toBeGreaterThan(1);
    // Phase check: every emitted line still sits on an integer authored offset.
    const geometry = geometryFor(value);
    for (const line of result.lines) {
      const family = geometry.families.find((candidate) => candidate.index === line.familyIndex)!;
      const [wx, wy] = unproject(camera, [line.x1, line.y1]);
      const offset =
        (wx - geometry.origin[0]) * family.normal[0] + (wy - geometry.origin[1]) * family.normal[1];
      const index = offset / family.offsetStep;
      expect(Math.abs(index - Math.round(index))).toBeLessThan(1e-6);
    }
  });

  it('returns an empty result for malformed configuration instead of NaN geometry', () => {
    const result = computeIsometricOverlayLines({
      grid: grid({ spacing: Number.NaN }),
      camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
      viewport,
    });
    expect(result.lines).toEqual([]);
    expect(result.geometry).toBeNull();
  });

  it('covers the viewport with bounded geometry when the origin is far away', () => {
    const camera = { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 };
    const value = grid({ originX: 1e6, originY: -1e6 });
    const result = computeIsometricOverlayLines({ grid: value, camera, viewport });
    // The lattice is infinite: lines exist near the viewport whatever the
    // origin, and the phase is still anchored to that far origin.
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines.length).toBeLessThan(4000);
    const geometry = geometryFor(value);
    for (const line of result.lines) {
      const family = geometry.families.find((candidate) => candidate.index === line.familyIndex)!;
      const [wx, wy] = unproject(camera, [line.x1, line.y1]);
      const offset =
        (wx - geometry.origin[0]) * family.normal[0] + (wy - geometry.origin[1]) * family.normal[1];
      const index = offset / family.offsetStep;
      expect(Math.abs(index - Math.round(index))).toBeLessThan(1e-3);
      expect(Number.isFinite(line.x1)).toBe(true);
      expect(Number.isFinite(line.y1)).toBe(true);
    }
  });

  it('groups lines into bounded path buckets', () => {
    const result = computeIsometricOverlayLines({
      grid: grid(),
      camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
      viewport,
    });
    const paths = groupIsometricOverlayPaths(result.lines);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThanOrEqual(3 * 2 * 2 * 2);
    for (const path of paths) {
      expect(path.d.startsWith('M')).toBe(true);
      expect(path.d.includes('NaN')).toBe(false);
    }
  });
});
