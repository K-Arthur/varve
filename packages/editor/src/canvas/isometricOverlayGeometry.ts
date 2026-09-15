/**
 * Pure viewport geometry for the isometric grid overlay.
 *
 * Consumes the canonical `@varve/scene` isometric geometry, so the overlay,
 * snapping, and plane-aware tools share one lattice. The SVG component stays
 * a thin projection/rendering layer; everything numerical is tested here.
 */

import type { IsometricGrid, IsometricGridGeometry, IsometricPlaneId } from '@varve/scene';
import {
  familiesForPlane,
  gridLinesForViewport,
  resolveIsometricGeometry,
  selectDisplayStep,
} from '@varve/scene';
import type { Camera } from '@varve/shared';
import { screenToWorld, worldToScreen } from '@varve/shared';

export interface IsometricOverlayLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  familyIndex: number;
  major: boolean;
  /** Family belongs to the active construction plane. */
  active: boolean;
  role: 'lattice' | 'guide';
  color?: string;
  opacity: number;
}

export interface IsometricOverlayInput {
  grid: IsometricGrid;
  camera: Camera;
  viewport: { width: number; height: number };
  activePlaneId?: IsometricPlaneId;
  /** Previously selected display multiplier, for hysteresis. */
  previousDisplayStep?: number;
  minScreenPx?: number;
  maxLinesPerFamily?: number;
}

export interface IsometricOverlayResult {
  lines: IsometricOverlayLine[];
  geometry: IsometricGridGeometry | null;
  displayStep: number;
}

const EMPTY_RESULT: IsometricOverlayResult = { lines: [], geometry: null, displayStep: 1 };

/**
 * Generate screen-space lines for the visible part of the grid. Returns an
 * empty result (never partial NaN geometry) when the configuration cannot be
 * resolved; callers keep the last valid render.
 */
export function computeIsometricOverlayLines(input: IsometricOverlayInput): IsometricOverlayResult {
  const { grid, camera, viewport } = input;
  if (!grid || viewport.width <= 0 || viewport.height <= 0) return EMPTY_RESULT;
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return EMPTY_RESULT;

  const geometry = resolveIsometricGeometry({
    originX: grid.originX,
    originY: grid.originY,
    spacing: grid.spacing,
    rotation: grid.rotation,
    axes: (grid.axes ?? []).map((axis) => ({
      angle: axis.angle,
      visible: axis.visible !== false,
      label: axis.label,
      color: axis.color,
      opacity: axis.opacity,
    })),
  });
  if (!geometry || geometry.families.length === 0) return EMPTY_RESULT;

  const corners = [
    screenToWorld(camera, 0, 0, viewport),
    screenToWorld(camera, viewport.width, 0, viewport),
    screenToWorld(camera, 0, viewport.height, viewport),
    screenToWorld(camera, viewport.width, viewport.height, viewport),
  ];

  const visibleFamilies = geometry.families.filter((family) => family.visible);
  const minStep = Math.min(...visibleFamilies.map((family) => Math.abs(family.offsetStep)));
  const displayStep = selectDisplayStep({
    minStep: Number.isFinite(minStep) && minStep > 0 ? minStep : geometry.spacing,
    zoom: camera.zoom,
    minScreenPx: input.minScreenPx ?? 7,
    previous: input.previousDisplayStep,
  });

  const segments = gridLinesForViewport(geometry, {
    corners,
    displayStep,
    majorEvery: grid.majorEvery ?? 4,
    maxLinesPerFamily: input.maxLinesPerFamily ?? 4096,
  });

  const activeFamilies = input.activePlaneId
    ? familiesForPlane(geometry, input.activePlaneId)
    : null;
  const activeIndices = new Set(activeFamilies ? activeFamilies.map((family) => family.index) : []);

  const familyById = new Map(geometry.families.map((family) => [family.index, family]));
  const lines: IsometricOverlayLine[] = [];
  for (const segment of segments) {
    const [x1, y1] = worldToScreen(camera, segment.x1, segment.y1, viewport);
    const [x2, y2] = worldToScreen(camera, segment.x2, segment.y2, viewport);
    if (
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      !Number.isFinite(x2) ||
      !Number.isFinite(y2)
    ) {
      continue;
    }
    // The world-space clip is the viewport's world AABB, which is a superset
    // of the visible region once the camera is rotated or the grid is skewed.
    // Clip again in screen space so the overlay paints exactly the viewport.
    const clipped = clipSegmentToViewport(x1, y1, x2, y2, viewport.width, viewport.height);
    if (!clipped) continue;
    const family = familyById.get(segment.familyIndex);
    lines.push({
      x1: clipped[0],
      y1: clipped[1],
      x2: clipped[2],
      y2: clipped[3],
      familyIndex: segment.familyIndex,
      major: segment.major,
      active: activeIndices.has(segment.familyIndex),
      role: segment.role,
      color: family?.color,
      opacity: family?.opacity ?? 1,
    });
  }

  return { lines, geometry, displayStep };
}

/**
 * Liang–Barsky clip of a screen-space segment to the viewport rectangle with
 * a half-pixel margin. Exported for tests.
 */
export function clipSegmentToViewport(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  height: number,
): [number, number, number, number] | null {
  const margin = 0.5;
  const xMin = -margin;
  const xMax = width + margin;
  const yMin = -margin;
  const yMax = height + margin;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, x1 - xMin)) return null;
  if (!clip(dx, xMax - x1)) return null;
  if (!clip(-dy, y1 - yMin)) return null;
  if (!clip(dy, yMax - y1)) return null;
  if (!(t0 <= t1)) return null;
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/**
 * Group lines into SVG path data keyed by style bucket. Rendering ≤6 paths
 * instead of one element per line keeps the overlay cheap at every zoom.
 */
export function groupIsometricOverlayPaths(lines: readonly IsometricOverlayLine[]): Array<{
  key: string;
  d: string;
  major: boolean;
  active: boolean;
  role: 'lattice' | 'guide';
  familyIndex: number;
  color?: string;
  opacity: number;
}> {
  const groups = new Map<
    string,
    {
      d: string[];
      major: boolean;
      active: boolean;
      role: 'lattice' | 'guide';
      familyIndex: number;
      color?: string;
      opacity: number;
    }
  >();
  for (const line of lines) {
    const key = `${line.familyIndex}:${line.major ? 'major' : 'minor'}:${line.active ? 'active' : 'idle'}:${line.role}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        d: [],
        major: line.major,
        active: line.active,
        role: line.role,
        familyIndex: line.familyIndex,
        color: line.color,
        opacity: line.opacity,
      };
      groups.set(key, group);
    }
    group.d.push(
      `M${line.x1.toFixed(2)} ${line.y1.toFixed(2)}L${line.x2.toFixed(2)} ${line.y2.toFixed(2)}`,
    );
  }
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    d: group.d.join(''),
    major: group.major,
    active: group.active,
    role: group.role,
    familyIndex: group.familyIndex,
    color: group.color,
    opacity: group.opacity,
  }));
}
