import { pageBoundsInWorld } from '@varve/scene';
import type { ResizeHandle, SelectionBox } from '@varve/shared';

export interface SnapGuide {
  axis: 'horizontal' | 'vertical';
  position: number;
  label?: string;
  distance?: number;
  type?: 'guide' | 'edge' | 'center' | 'midpoint' | 'spacing' | 'rotation' | 'size-match';
}

export interface GridSnapConfig {
  spacingX: number;
  spacingY: number;
  offsetX?: number;
  offsetY?: number;
}

export interface SnapBoxOptions {
  zoom?: number;
  otherBounds?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Handle that produced this box. Enables anchor-preserving resize snaps. */
  resizeHandle?: ResizeHandle;
  /** A centred resize has no fixed opposite edge. */
  resizeCentered?: boolean;
  grid?: number | GridSnapConfig;
  layoutGridStep?: number;
  pixelGridSnap?: boolean;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/** Sticky snap session — tracks active snap locks per axis (hysteresis). */
export interface SnapSession {
  stickyX: { guidePosition: number; snappedCoord: number } | null;
  stickyY: { guidePosition: number; snappedCoord: number } | null;
}

export interface SnapOptions {
  /** Current zoom for screen-pixel threshold scaling. Default 1. */
  zoom?: number;
  /** Prior sticky session for hysteresis. */
  session?: SnapSession | null;
  /** Enable sticky (hysteresis) snap. Default true. */
  sticky?: boolean;
  /** Permanent ruler guides that objects can snap to. */
  guideTargets?: Array<{ axis: 'horizontal' | 'vertical'; position: number }>;
  /** Layout grid cell size for frame grid snapping (world units). */
  layoutGridStep?: number;
  /** Pixel grid snapping (snaps to integer pixel coordinates). */
  pixelGridSnap?: boolean;
}

export const SNAP_RANGE_PX = 200;

export function snapTargetSearchRect(
  bounds: { x: number; y: number; w: number; h: number },
  zoom: number,
): { x: number; y: number; w: number; h: number } {
  const padding = SNAP_RANGE_PX / Math.max(0.001, zoom);
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  };
}

function thresholdWorld(zoom: number): number {
  return 8 / Math.max(0.001, zoom);
}

function releaseThresholdWorld(zoom: number): number {
  return thresholdWorld(zoom) * 1.5;
}

/** Screen-space bounding box of a target (cx, cy, half-extent). */
function screenBounds(
  b: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: (b.x + b.w / 2) * camera.zoom,
    cy: (b.y + b.h / 2) * camera.zoom,
    rx: (b.w / 2) * camera.zoom,
    ry: (b.h / 2) * camera.zoom,
  };
}

function intersect(
  a: ReturnType<typeof screenBounds>,
  b: ReturnType<typeof screenBounds>,
): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.rx + b.rx + SNAP_RANGE_PX &&
    Math.abs(a.cy - b.cy) < a.ry + b.ry + SNAP_RANGE_PX
  );
}

export function filterSnapTargets(
  draggedBounds: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
  allBounds: Array<{
    nodeId: string;
    bounds: { x: number; y: number; w: number; h: number };
  }>,
  parentIndex: Map<string, string | null>,
  draggedId: string,
  excludedIds?: ReadonlySet<string>,
): Array<{ x: number; y: number; w: number; h: number }> {
  const draggedParent = parentIndex.get(draggedId) ?? null;
  const draggedScreen = screenBounds(draggedBounds, camera);
  const results: Array<{ x: number; y: number; w: number; h: number; priority: number }> = [];

  for (const entry of allBounds) {
    // Semantic filter: the dragged object, every sibling moving in the same
    // selection, and any explicitly excluded node can never be a valid target.
    if (entry.nodeId === draggedId) continue;
    if (excludedIds?.has(entry.nodeId)) continue;
    const targetScreen = screenBounds(entry.bounds, camera);
    if (!intersect(draggedScreen, targetScreen)) continue;
    const targetParent = parentIndex.get(entry.nodeId) ?? null;
    const priority = draggedParent !== null && targetParent === draggedParent ? 0 : 1;
    results.push({ ...entry.bounds, priority });
  }

  results.sort((a, b) => a.priority - b.priority);
  return results.map(({ priority: _, ...bounds }) => bounds);
}

function tryStickyAxis(
  currentCoord: number,
  proposedCoord: number,
  guidePosition: number,
  session: SnapSession['stickyX'],
  _thresh: number,
  release: number,
  sticky: boolean,
): { coord: number; session: SnapSession['stickyX']; snapped: boolean } {
  if (sticky && session && Math.abs(currentCoord - session.snappedCoord) < release) {
    return { coord: session.snappedCoord, session, snapped: true };
  }
  return {
    coord: proposedCoord,
    session: { guidePosition, snappedCoord: proposedCoord },
    snapped: true,
  };
}

const SNAP_PRIORITY = {
  grid: 100,
  guide: 90,
  layoutGrid: 85,
  edge: 80,
  center: 70,
  midpoint: 50,
  spacing: 30,
} as const;

/** Compete a new snap candidate; returns true if it wins (higher priority or same priority + closer). */
function compete(
  candidatePrio: number,
  candidateDiff: number,
  bestPrio: number,
  bestDiff: number,
): boolean {
  return candidatePrio > bestPrio || (candidatePrio === bestPrio && candidateDiff < bestDiff);
}

/**
 * Binary-search the index whose sorted value is closest to `target`, excluding
 * `exclude`. Ties resolve to the smallest original index, matching the
 * pair-scan iteration order of the canonical O(k²) evaluators this replaces.
 * Returns -1 when the only candidate is the excluded index itself.
 */
function findClosest(sorted: number[], order: number[], target: number, exclude: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDiff = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx < 0 || idx >= sorted.length) continue;
    const orig = order[idx]!;
    if (orig === exclude) continue;
    const d = Math.abs(sorted[idx]! - target);
    if (best === -1 || d < bestDiff || (d === bestDiff && orig < order[best]!)) {
      best = idx;
      bestDiff = d;
    }
  }
  return best === -1 ? -1 : order[best]!;
}

/**
 * Find the partner index minimizing |sorted[idx] - target| among entries with
 * value strictly greater than `min` (used for gap snap candidates that must
 * straddle the moving center). Same tie-breaking as {@link findClosest}.
 */
function findClosestGap(
  sorted: number[],
  order: number[],
  target: number,
  exclude: number,
  min: number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= min) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  lo = start;
  hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDiff = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx < start || idx >= sorted.length) continue;
    const orig = order[idx]!;
    if (orig === exclude) continue;
    const d = Math.abs(sorted[idx]! - target);
    if (best === -1 || d < bestDiff || (d === bestDiff && orig < order[best]!)) {
      best = idx;
      bestDiff = d;
    }
  }
  return best === -1 ? -1 : order[best]!;
}

function snapCoordToGrid(value: number, spacing: number, offset = 0): number {
  if (spacing <= 0) return value;
  return Math.round((value - offset) / spacing) * spacing + offset;
}

export function snapPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  grid?: number | GridSnapConfig,
  snapExcludedIds?: Set<string>,
  options: SnapOptions = {},
): SnapResult & { session: SnapSession } {
  const zoom = options.zoom ?? 1;
  const sticky = options.sticky !== false;
  const thresh = thresholdWorld(zoom);
  const release = releaseThresholdWorld(zoom);
  let session: SnapSession = options.session ?? { stickyX: null, stickyY: null };

  let snappedX = x;
  let snappedY = y;
  const guides: SnapGuide[] = [];

  const activeBounds =
    snapExcludedIds && snapExcludedIds.size > 0
      ? otherBounds.filter((_, i) => !snapExcludedIds.has(String(i)))
      : otherBounds;

  const cx = x + w / 2;
  const cy = y + h / 2;
  const edges = { left: x, right: x + w, centerX: cx, top: y, bottom: y + h, centerY: cy };

  let bestXDiff = Infinity;
  let bestXSnap = x;
  let bestXGuide: SnapGuide | null = null;
  let bestXPriority = -1;
  let bestYDiff = Infinity;
  let bestYSnap = y;
  let bestYGuide: SnapGuide | null = null;
  let bestYPriority = -1;

  // C1: Grid snap (highest priority)
  if (grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      const offsetX = gridConfig.offsetX ?? 0;
      const offsetY = gridConfig.offsetY ?? 0;
      const gx = snapCoordToGrid(x, gridConfig.spacingX, offsetX);
      const gy = snapCoordToGrid(y, gridConfig.spacingY, offsetY);
      const dx = Math.abs(gx - x);
      const dy = Math.abs(gy - y);
      const prio = SNAP_PRIORITY.grid;
      if (dx < thresh && compete(prio, dx, bestXPriority, bestXDiff)) {
        bestXDiff = dx;
        bestXSnap = gx;
        bestXGuide = { axis: 'vertical', position: gx, label: `${gx}px`, type: 'edge' };
        bestXPriority = prio;
      }
      if (dy < thresh && compete(prio, dy, bestYPriority, bestYDiff)) {
        bestYDiff = dy;
        bestYSnap = gy;
        bestYGuide = { axis: 'horizontal', position: gy, label: `${gy}px`, type: 'edge' };
        bestYPriority = prio;
      }
    }
  }

  // C2: Layout grid snap
  if (options.layoutGridStep && options.layoutGridStep > 0) {
    const step = options.layoutGridStep;
    const lx = Math.round(x / step) * step;
    const ly = Math.round(y / step) * step;
    const dx = Math.abs(lx - x);
    const dy = Math.abs(ly - y);
    const prio = SNAP_PRIORITY.layoutGrid;
    if (dx < thresh && compete(prio, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXSnap = lx;
      bestXGuide = { axis: 'vertical', position: lx, type: 'edge' };
      bestXPriority = prio;
    }
    if (dy < thresh && compete(prio, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYSnap = ly;
      bestYGuide = { axis: 'horizontal', position: ly, type: 'edge' };
      bestYPriority = prio;
    }
  }

  // C3: Pixel grid snap (snaps to integer pixel coordinates)
  if (options.pixelGridSnap) {
    const px = Math.round(x);
    const py = Math.round(y);
    const dx = Math.abs(px - x);
    const dy = Math.abs(py - y);
    const prio = SNAP_PRIORITY.grid; // Use same priority as document grid
    if (dx < thresh && compete(prio, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXSnap = px;
      bestXGuide = { axis: 'vertical', position: px, label: `${px}px`, type: 'edge' };
      bestXPriority = prio;
    }
    if (dy < thresh && compete(prio, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYSnap = py;
      bestYGuide = { axis: 'horizontal', position: py, label: `${py}px`, type: 'edge' };
      bestYPriority = prio;
    }
  }

  // C2.5: Permanent ruler guides. These are line targets, so compare every
  // movable edge/center on the matching axis against the guide's position.
  if (options.guideTargets && options.guideTargets.length > 0) {
    for (const guide of options.guideTargets) {
      const prio = SNAP_PRIORITY.guide;
      if (guide.axis === 'vertical') {
        for (const key of ['left', 'centerX', 'right'] as const) {
          const diff = edges[key] - guide.position;
          const absDiff = Math.abs(diff);
          if (absDiff < thresh && compete(prio, absDiff, bestXPriority, bestXDiff)) {
            bestXDiff = absDiff;
            bestXSnap = x - diff;
            bestXGuide = {
              axis: 'vertical',
              position: guide.position,
              distance: absDiff,
              type: 'guide',
              label: 'guide',
            };
            bestXPriority = prio;
          }
        }
      } else {
        for (const key of ['top', 'centerY', 'bottom'] as const) {
          const diff = edges[key] - guide.position;
          const absDiff = Math.abs(diff);
          if (absDiff < thresh && compete(prio, absDiff, bestYPriority, bestYDiff)) {
            bestYDiff = absDiff;
            bestYSnap = y - diff;
            bestYGuide = {
              axis: 'horizontal',
              position: guide.position,
              distance: absDiff,
              type: 'guide',
              label: 'guide',
            };
            bestYPriority = prio;
          }
        }
      }
    }
  }

  // C3: Mid-point between two objects. The canonical evaluation scans every
  // unordered pair (O(k²)); the criterion is symmetric, so the winning pair
  // is found by sorting centers once and, per node, binary-searching the
  // partner whose center is closest to (2*cx - center) — O(k log k) with
  // identical winners (verified against the pair scan by the parity tests in
  // tools/__benchmarks__/snapParity.bench.test.ts).
  if (activeBounds.length > 1) {
    const n = activeBounds.length;
    const centersX: number[] = new Array(n);
    const centersY: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const b = activeBounds[i]!;
      centersX[i] = b.x + b.w / 2;
      centersY[i] = b.y + b.h / 2;
    }
    const xOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => centersX[i]! - centersX[j]!,
    );
    const yOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => centersY[i]! - centersY[j]!,
    );
    const sortedX = xOrder.map((i) => centersX[i]!);
    const sortedY = yOrder.map((i) => centersY[i]!);
    const prio = SNAP_PRIORITY.midpoint;

    for (let i = 0; i < n; i++) {
      const xTarget = 2 * cx - centersX[i]!;
      const xPartner = findClosest(sortedX, xOrder, xTarget, i);
      if (xPartner !== -1) {
        const midX = (centersX[i]! + centersX[xPartner]!) / 2;
        const dmx = Math.abs(cx - midX);
        if (dmx < thresh && compete(prio, dmx, bestXPriority, bestXDiff)) {
          bestXDiff = dmx;
          bestXSnap = x - (cx - midX);
          bestXGuide = { axis: 'vertical', position: midX, type: 'midpoint', label: 'mid' };
          bestXPriority = prio;
        }
      }
      const yTarget = 2 * cy - centersY[i]!;
      const yPartner = findClosest(sortedY, yOrder, yTarget, i);
      if (yPartner !== -1) {
        const midY = (centersY[i]! + centersY[yPartner]!) / 2;
        const dmy = Math.abs(cy - midY);
        if (dmy < thresh && compete(prio, dmy, bestYPriority, bestYDiff)) {
          bestYDiff = dmy;
          bestYSnap = y - (cy - midY);
          bestYGuide = { axis: 'horizontal', position: midY, type: 'midpoint', label: 'mid' };
          bestYPriority = prio;
        }
      }
    }
  }

  for (const b of activeBounds) {
    const bCX = b.x + b.w / 2;
    const bCY = b.y + b.h / 2;
    const bEdges = {
      left: b.x,
      right: b.x + b.w,
      centerX: bCX,
      top: b.y,
      bottom: b.y + b.h,
      centerY: bCY,
    };

    for (const key of ['left', 'centerX', 'right'] as const) {
      const diff = edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerX' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
      if (absDiff < thresh && compete(prio, absDiff, bestXPriority, bestXDiff)) {
        bestXDiff = absDiff;
        bestXSnap = x - diff;
        bestXGuide = {
          axis: 'vertical',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerX' ? 'center' : 'edge',
        };
        bestXPriority = prio;
      }
    }

    for (const key of ['top', 'centerY', 'bottom'] as const) {
      const diff = edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerY' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
      if (absDiff < thresh && compete(prio, absDiff, bestYPriority, bestYDiff)) {
        bestYDiff = absDiff;
        bestYSnap = y - diff;
        bestYGuide = {
          axis: 'horizontal',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerY' ? 'center' : 'edge',
        };
        bestYPriority = prio;
      }
    }
  }

  if (bestXGuide) {
    const stickyResult = tryStickyAxis(
      x,
      bestXSnap,
      bestXGuide.position,
      session.stickyX,
      thresh,
      release,
      sticky,
    );
    snappedX = stickyResult.coord;
    session = { ...session, stickyX: stickyResult.snapped ? stickyResult.session : null };
    if (stickyResult.snapped || !sticky) guides.push(bestXGuide);
  } else if (sticky && session.stickyX) {
    const hold = tryStickyAxis(
      x,
      x,
      session.stickyX.guidePosition,
      session.stickyX,
      thresh,
      release,
      true,
    );
    if (hold.snapped) snappedX = hold.coord;
    else session = { ...session, stickyX: null };
  }

  if (bestYGuide) {
    const stickyResult = tryStickyAxis(
      y,
      bestYSnap,
      bestYGuide.position,
      session.stickyY,
      thresh,
      release,
      sticky,
    );
    snappedY = stickyResult.coord;
    session = { ...session, stickyY: stickyResult.snapped ? stickyResult.session : null };
    if (stickyResult.snapped || !sticky) guides.push(bestYGuide);
  } else if (sticky && session.stickyY) {
    const hold = tryStickyAxis(
      y,
      y,
      session.stickyY.guidePosition,
      session.stickyY,
      thresh,
      release,
      true,
    );
    if (hold.snapped) snappedY = hold.coord;
    else session = { ...session, stickyY: null };
  }

  // C4: Spacing distribution (lowest priority). The canonical evaluation is
  // O(k²) over every ordered pair (a,b) with a.right < cx < b.left. Because
  // |gap - (mid - cx)| equals |b.left - 3*a.right + 2*cx| / 2, the best b for
  // a fixed a is the left edge closest to (3*a.right - 2*cx) among left edges
  // > cx — a sorted binary search, reducing the rule to O(k log k) with
  // identical winners (parity-verified).
  if (otherBounds.length > 1) {
    const n = otherBounds.length;
    const rightEdges: number[] = new Array(n);
    const bottomEdges: number[] = new Array(n);
    const leftEdges: number[] = new Array(n);
    const topEdges: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const b = otherBounds[i]!;
      rightEdges[i] = b.x + b.w;
      bottomEdges[i] = b.y + b.h;
      leftEdges[i] = b.x;
      topEdges[i] = b.y;
    }
    const xOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => leftEdges[i]! - leftEdges[j]!,
    );
    const yOrder = Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => topEdges[i]! - topEdges[j]!,
    );
    const sortedLeft = xOrder.map((i) => leftEdges[i]!);
    const sortedTop = yOrder.map((i) => topEdges[i]!);
    const prio = SNAP_PRIORITY.spacing;

    let bestXGap: { mid: number; gap: number; obj: number } | null = null;
    for (let i = 0; i < n; i++) {
      const ra = rightEdges[i]!;
      if (!(ra < cx)) continue;
      const target = 3 * ra - 2 * cx;
      const j = findClosestGap(sortedLeft, xOrder, target, i, cx);
      if (j === -1) continue;
      const mid = (ra + leftEdges[j]!) / 2;
      const gap = leftEdges[j]! - ra;
      const obj = Math.abs(gap - (mid - cx));
      if (bestXGap === null || obj < bestXGap.obj) bestXGap = { mid, gap, obj };
    }
    if (bestXGap) {
      const dmx = Math.abs(cx - bestXGap.mid);
      if (dmx < thresh * 3 && compete(prio, dmx, bestXPriority, bestXDiff)) {
        snappedX = x - (cx - bestXGap.mid);
        guides.push({
          axis: 'vertical',
          position: bestXGap.mid,
          type: 'spacing',
          label: `${Math.round(bestXGap.gap)}px`,
        });
      }
    }

    let bestYGap: { mid: number; gap: number; obj: number } | null = null;
    for (let i = 0; i < n; i++) {
      const ba = bottomEdges[i]!;
      if (!(ba < cy)) continue;
      const target = 3 * ba - 2 * cy;
      const j = findClosestGap(sortedTop, yOrder, target, i, cy);
      if (j === -1) continue;
      const mid = (ba + topEdges[j]!) / 2;
      const gap = topEdges[j]! - ba;
      const obj = Math.abs(gap - (mid - cy));
      if (bestYGap === null || obj < bestYGap.obj) bestYGap = { mid, gap, obj };
    }
    if (bestYGap) {
      const dmy = Math.abs(cy - bestYGap.mid);
      if (dmy < thresh * 3 && compete(prio, dmy, bestYPriority, bestYDiff)) {
        snappedY = y - (cy - bestYGap.mid);
        guides.push({
          axis: 'horizontal',
          position: bestYGap.mid,
          type: 'spacing',
          label: `${Math.round(bestYGap.gap)}px`,
        });
      }
    }
  }

  return { x: snappedX, y: snappedY, guides, session };
}

export function snapSize(
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  zoom = 1,
): { w: number; h: number; matched: boolean; guide?: SnapGuide } {
  const threshold = thresholdWorld(zoom);
  for (const b of otherBounds) {
    if (Math.abs(b.w - w) < threshold) {
      return {
        w: b.w,
        h,
        matched: true,
        guide: { axis: 'horizontal', position: 0, type: 'size-match', label: `${b.w}px` },
      };
    }
    if (Math.abs(b.h - h) < threshold) {
      return {
        w,
        h: b.h,
        matched: true,
        guide: { axis: 'vertical', position: 0, type: 'size-match', label: `${b.h}px` },
      };
    }
  }
  return { w, h, matched: false };
}

/** Create a fresh snap session (call on pointer down). */
export function createSnapSession(): SnapSession {
  return { stickyX: null, stickyY: null };
}

type ResizeSide = 'start' | 'end';

interface ResizeAxisTarget {
  position: number;
  priority: number;
}

interface ResizeAxisSnap {
  center: number;
  size: number;
  priority: number;
  diff: number;
}

function resizeSideForHandle(handle: ResizeHandle, axis: 'x' | 'y'): ResizeSide | null {
  if (axis === 'x') {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') return 'start';
    if (handle === 'e' || handle === 'ne' || handle === 'se') return 'end';
  } else {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') return 'start';
    if (handle === 's' || handle === 'sw' || handle === 'se') return 'end';
  }
  return null;
}

/**
 * Snap the moving side of a resize without translating its opposite anchor.
 * A generic selection-box snap may safely translate a box; doing that during
 * resize makes the fixed handle side drift, so resize has its own resolver.
 */
function snapResizeAxis(
  center: number,
  size: number,
  side: ResizeSide,
  targets: ResizeAxisTarget[],
  centered: boolean,
  threshold: number,
): ResizeAxisSnap | null {
  const moving = center + (side === 'end' ? size / 2 : -size / 2);
  const fixed = center + (side === 'end' ? -size / 2 : size / 2);
  let best: ResizeAxisSnap | null = null;

  for (const target of targets) {
    const diff = Math.abs(moving - target.position);
    if (diff >= threshold) continue;
    if (best && !compete(target.priority, diff, best.priority, best.diff)) continue;

    const nextSize = centered
      ? size + (side === 'end' ? 2 * (target.position - moving) : 2 * (moving - target.position))
      : side === 'end'
        ? target.position - fixed
        : fixed - target.position;
    if (nextSize <= Number.EPSILON) continue;
    best = {
      center: centered ? center : (fixed + target.position) / 2,
      size: nextSize,
      priority: target.priority,
      diff,
    };
  }

  return best;
}

function objectAxisTargets(
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  axis: 'x' | 'y',
): ResizeAxisTarget[] {
  const targets: ResizeAxisTarget[] = [];
  for (const b of otherBounds) {
    const start = axis === 'x' ? b.x : b.y;
    const size = axis === 'x' ? b.w : b.h;
    targets.push(
      { position: start, priority: SNAP_PRIORITY.edge },
      { position: start + size / 2, priority: SNAP_PRIORITY.center },
      { position: start + size, priority: SNAP_PRIORITY.edge },
    );
  }
  return targets;
}

function snapResizeAxisToGrid(
  center: number,
  size: number,
  side: ResizeSide,
  spacing: number,
  offset: number,
  centered: boolean,
  threshold: number,
  priority: number,
): ResizeAxisSnap | null {
  const moving = center + (side === 'end' ? size / 2 : -size / 2);
  return snapResizeAxis(
    center,
    size,
    side,
    [{ position: snapCoordToGrid(moving, spacing, offset), priority }],
    centered,
    threshold,
  );
}

/** Snap a selection box (position and size) to other bounds. */
export function snapSelectionBox(box: SelectionBox, options: SnapBoxOptions = {}): SelectionBox {
  const {
    zoom = 1,
    otherBounds = [],
    resizeHandle,
    resizeCentered = false,
    grid,
    layoutGridStep,
    pixelGridSnap,
  } = options;
  const thresh = thresholdWorld(zoom);

  let snappedCx = box.cx;
  let snappedCy = box.cy;
  let snappedW = box.w;
  let snappedH = box.h;

  let bestXDiff = Infinity;
  let bestXPriority = -1;
  let bestYDiff = Infinity;
  let bestYPriority = -1;
  const isAxisAligned = Math.abs(Math.sin(box.rotation)) < 1e-9;
  const resizeX = resizeHandle ? resizeSideForHandle(resizeHandle, 'x') : null;
  const resizeY = resizeHandle ? resizeSideForHandle(resizeHandle, 'y') : null;
  const canSnapResizeAxes = isAxisAligned && (resizeX !== null || resizeY !== null);

  // Use the same-anchor edge/center matching as move snapping. Resize
  // gestures already call this resolver through TransformEngine, so teaching
  // this path about edges fixes handle-drag snapping without inventing a
  // parallel candidate model. An oriented box has no world-axis-aligned edges
  // at arbitrary rotation; its centre is still meaningful, but edge matching
  // is intentionally restricted to axis-aligned selections.
  if (otherBounds.length > 0) {
    if (canSnapResizeAxes && resizeX) {
      const snap = snapResizeAxis(
        box.cx,
        box.w,
        resizeX,
        objectAxisTargets(otherBounds, 'x'),
        resizeCentered,
        thresh,
      );
      if (snap) {
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (canSnapResizeAxes && resizeY) {
      const snap = snapResizeAxis(
        box.cy,
        box.h,
        resizeY,
        objectAxisTargets(otherBounds, 'y'),
        resizeCentered,
        thresh,
      );
      if (snap) {
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
    if (!resizeHandle) {
      const boxEdges = {
        left: box.cx - box.w / 2,
        right: box.cx + box.w / 2,
        centerX: box.cx,
        top: box.cy - box.h / 2,
        bottom: box.cy + box.h / 2,
        centerY: box.cy,
      };
      for (const b of otherBounds) {
        const targetEdges = {
          left: b.x,
          right: b.x + b.w,
          centerX: b.x + b.w / 2,
          top: b.y,
          bottom: b.y + b.h,
          centerY: b.y + b.h / 2,
        };

        for (const key of ['left', 'centerX', 'right'] as const) {
          if (!isAxisAligned && key !== 'centerX') continue;
          const diff = boxEdges[key] - targetEdges[key];
          const absDiff = Math.abs(diff);
          const priority = key === 'centerX' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
          if (absDiff < thresh && compete(priority, absDiff, bestXPriority, bestXDiff)) {
            bestXDiff = absDiff;
            bestXPriority = priority;
            snappedCx = box.cx - diff;
          }
        }

        for (const key of ['top', 'centerY', 'bottom'] as const) {
          if (!isAxisAligned && key !== 'centerY') continue;
          const diff = boxEdges[key] - targetEdges[key];
          const absDiff = Math.abs(diff);
          const priority = key === 'centerY' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
          if (absDiff < thresh && compete(priority, absDiff, bestYPriority, bestYDiff)) {
            bestYDiff = absDiff;
            bestYPriority = priority;
            snappedCy = box.cy - diff;
          }
        }
      }
    }
  }

  // Snap to grid (higher priority than center)
  if (canSnapResizeAxes && grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      if (resizeX) {
        const snap = snapResizeAxisToGrid(
          box.cx,
          box.w,
          resizeX,
          gridConfig.spacingX,
          gridConfig.offsetX ?? 0,
          resizeCentered,
          thresh,
          SNAP_PRIORITY.grid,
        );
        if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
          snappedCx = snap.center;
          snappedW = snap.size;
          bestXDiff = snap.diff;
          bestXPriority = snap.priority;
        }
      }
      if (resizeY) {
        const snap = snapResizeAxisToGrid(
          box.cy,
          box.h,
          resizeY,
          gridConfig.spacingY,
          gridConfig.offsetY ?? 0,
          resizeCentered,
          thresh,
          SNAP_PRIORITY.grid,
        );
        if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
          snappedCy = snap.center;
          snappedH = snap.size;
          bestYDiff = snap.diff;
          bestYPriority = snap.priority;
        }
      }
    }
  } else if (!resizeHandle && grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      const offsetX = gridConfig.offsetX ?? 0;
      const offsetY = gridConfig.offsetY ?? 0;
      const gridCx = snapCoordToGrid(box.cx, gridConfig.spacingX, offsetX);
      const gridCy = snapCoordToGrid(box.cy, gridConfig.spacingY, offsetY);
      const dx = Math.abs(gridCx - box.cx);
      const dy = Math.abs(gridCy - box.cy);
      if (dx < thresh && compete(SNAP_PRIORITY.grid, dx, bestXPriority, bestXDiff)) {
        bestXDiff = dx;
        bestXPriority = SNAP_PRIORITY.grid;
        snappedCx = gridCx;
      }
      if (dy < thresh && compete(SNAP_PRIORITY.grid, dy, bestYPriority, bestYDiff)) {
        bestYDiff = dy;
        bestYPriority = SNAP_PRIORITY.grid;
        snappedCy = gridCy;
      }
    }
  }

  // Snap to pixel grid (snaps to integer pixel coordinates)
  if (canSnapResizeAxes && pixelGridSnap) {
    if (resizeX) {
      const snap = snapResizeAxisToGrid(
        box.cx,
        box.w,
        resizeX,
        1,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.grid,
      );
      if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (resizeY) {
      const snap = snapResizeAxisToGrid(
        box.cy,
        box.h,
        resizeY,
        1,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.grid,
      );
      if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
  } else if (!resizeHandle && pixelGridSnap) {
    const px = Math.round(box.cx);
    const py = Math.round(box.cy);
    const dx = Math.abs(px - box.cx);
    const dy = Math.abs(py - box.cy);
    if (dx < thresh && compete(SNAP_PRIORITY.grid, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXPriority = SNAP_PRIORITY.grid;
      snappedCx = px;
    }
    if (dy < thresh && compete(SNAP_PRIORITY.grid, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYPriority = SNAP_PRIORITY.grid;
      snappedCy = py;
    }
  }

  // Snap to layout grid
  if (canSnapResizeAxes && layoutGridStep && layoutGridStep > 0) {
    if (resizeX) {
      const snap = snapResizeAxisToGrid(
        box.cx,
        box.w,
        resizeX,
        layoutGridStep,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.layoutGrid,
      );
      if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (resizeY) {
      const snap = snapResizeAxisToGrid(
        box.cy,
        box.h,
        resizeY,
        layoutGridStep,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.layoutGrid,
      );
      if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
  } else if (!resizeHandle && layoutGridStep && layoutGridStep > 0) {
    const step = layoutGridStep;
    const lx = Math.round(box.cx / step) * step;
    const ly = Math.round(box.cy / step) * step;
    const dx = Math.abs(lx - box.cx);
    const dy = Math.abs(ly - box.cy);
    if (dx < thresh && compete(SNAP_PRIORITY.layoutGrid, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXPriority = SNAP_PRIORITY.layoutGrid;
      snappedCx = lx;
    }
    if (dy < thresh && compete(SNAP_PRIORITY.layoutGrid, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYPriority = SNAP_PRIORITY.layoutGrid;
      snappedCy = ly;
    }
  }

  // Snap size
  // Object-edge snapping may already have changed a resize dimension. Match
  // size against that resolved result so an unchanged perpendicular dimension
  // cannot restore the pre-snap width or height.
  const sizeSnap = snapSize(snappedW, snappedH, otherBounds, zoom);
  if (sizeSnap.matched) {
    snappedW = sizeSnap.w;
    snappedH = sizeSnap.h;
  }

  return {
    cx: snappedCx,
    cy: snappedCy,
    w: snappedW,
    h: snappedH,
    rotation: box.rotation,
  };
}

/**
 * Page trim snap targets for the shared multipage canvas (M6, ADR-0144):
 * the placed trim bounds of every page in the document, so nodes snap to
 * page edges on any page — not only the active page's trim at the origin.
 */
export function pageSnapTargets(
  doc: import('@varve/scene').Document,
): Array<{ x: number; y: number; w: number; h: number }> {
  const targets: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const page of doc.pages ?? []) {
    const bounds = pageBoundsInWorld(doc, page.id);
    if (bounds) targets.push(bounds);
  }
  return targets;
}
