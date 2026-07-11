import type { SelectionBox } from '@strata/shared';

export interface SnapGuide {
  axis: 'horizontal' | 'vertical';
  position: number;
  label?: string;
  distance?: number;
  type?: 'edge' | 'center' | 'midpoint' | 'spacing' | 'rotation' | 'size-match';
}

export interface SnapBoxOptions {
  zoom?: number;
  otherBounds?: Array<{ x: number; y: number; w: number; h: number }>;
  grid?: number;
  layoutGridStep?: number;
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
  /** Layout grid cell size for frame grid snapping (world units). */
  layoutGridStep?: number;
}

const SNAP_RANGE_PX = 200;

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
): Array<{ x: number; y: number; w: number; h: number }> {
  const draggedParent = parentIndex.get(draggedId) ?? null;
  const draggedScreen = screenBounds(draggedBounds, camera);
  const results: Array<{ x: number; y: number; w: number; h: number; priority: number }> = [];

  for (const entry of allBounds) {
    if (entry.nodeId === draggedId) continue;
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

const SNAP_PRIORITY: Record<string, number> = {
  grid: 100,
  edge: 80,
  center: 70,
  midpoint: 50,
  spacing: 30,
  layoutGrid: 20,
};

/** Compete a new snap candidate; returns true if it wins (higher priority or same priority + closer). */
function compete(
  candidatePrio: number,
  candidateDiff: number,
  bestPrio: number,
  bestDiff: number,
): boolean {
  return candidatePrio > bestPrio || (candidatePrio === bestPrio && candidateDiff < bestDiff);
}

export function snapPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  grid?: number,
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
  if (grid && grid > 0) {
    const gx = Math.round(x / grid) * grid;
    const gy = Math.round(y / grid) * grid;
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

  // C3: Mid-point between two objects
  for (let i = 0; i < activeBounds.length; i++) {
    const a = activeBounds[i]!;
    for (let j = i + 1; j < activeBounds.length; j++) {
      const b = activeBounds[j]!;
      const midX = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
      const midY = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
      const dmx = Math.abs(cx - midX);
      const dmy = Math.abs(cy - midY);
      const prio = SNAP_PRIORITY.midpoint;
      if (dmx < thresh && compete(prio, dmx, bestXPriority, bestXDiff)) {
        bestXDiff = dmx;
        bestXSnap = x - (cx - midX);
        bestXGuide = { axis: 'vertical', position: midX, type: 'midpoint', label: 'mid' };
        bestXPriority = prio;
      }
      if (dmy < thresh && compete(prio, dmy, bestYPriority, bestYDiff)) {
        bestYDiff = dmy;
        bestYSnap = y - (cy - midY);
        bestYGuide = { axis: 'horizontal', position: midY, type: 'midpoint', label: 'mid' };
        bestYPriority = prio;
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

  // C4: Spacing distribution (lowest priority)
  const xGaps: { mid: number; gap: number }[] = [];
  const yGaps: { mid: number; gap: number }[] = [];
  for (const a of otherBounds) {
    for (const b of otherBounds) {
      if (a === b) continue;
      const gapX = b.x - (a.x + a.w);
      if (gapX > 0 && a.x + a.w < cx && b.x > cx) {
        xGaps.push({ mid: (a.x + a.w + b.x) / 2, gap: gapX });
      }
      const gapY = b.y - (a.y + a.h);
      if (gapY > 0 && a.y + a.h < cy && b.y > cy) {
        yGaps.push({ mid: (a.y + a.h + b.y) / 2, gap: gapY });
      }
    }
  }
  if (xGaps.length > 0) {
    const best = xGaps.reduce((a, b) =>
      Math.abs(a.gap - (a.mid - cx)) < Math.abs(b.gap - (b.mid - cx)) ? a : b,
    );
    const dmx = Math.abs(cx - best.mid);
    const prio = SNAP_PRIORITY.spacing;
    if (dmx < thresh * 3 && compete(prio, dmx, bestXPriority, bestXDiff)) {
      snappedX = x - (cx - best.mid);
      guides.push({
        axis: 'vertical',
        position: best.mid,
        type: 'spacing',
        label: `${Math.round(best.gap)}px`,
      });
    }
  }
  if (yGaps.length > 0) {
    const best = yGaps.reduce((a, b) =>
      Math.abs(a.gap - (a.mid - cy)) < Math.abs(b.gap - (b.mid - cy)) ? a : b,
    );
    const dmy = Math.abs(cy - best.mid);
    const prio = SNAP_PRIORITY.spacing;
    if (dmy < thresh * 3 && compete(prio, dmy, bestYPriority, bestYDiff)) {
      snappedY = y - (cy - best.mid);
      guides.push({
        axis: 'horizontal',
        position: best.mid,
        type: 'spacing',
        label: `${Math.round(best.gap)}px`,
      });
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

/** Snap a selection box (position and size) to other bounds. */
export function snapSelectionBox(box: SelectionBox, options: SnapBoxOptions = {}): SelectionBox {
  const { zoom = 1, otherBounds = [], grid, layoutGridStep } = options;
  const thresh = thresholdWorld(zoom);

  let snappedCx = box.cx;
  let snappedCy = box.cy;
  let snappedW = box.w;
  let snappedH = box.h;

  let bestXDiff = Infinity;
  let bestXPriority = -1;
  let bestYDiff = Infinity;
  let bestYPriority = -1;

  // Snap position (center) — priority: center
  if (otherBounds.length > 0) {
    for (const b of otherBounds) {
      const bCx = b.x + b.w / 2;
      const bCy = b.y + b.h / 2;

      const xDiff = Math.abs(box.cx - bCx);
      const yDiff = Math.abs(box.cy - bCy);

      if (xDiff < thresh && compete(SNAP_PRIORITY.center, xDiff, bestXPriority, bestXDiff)) {
        bestXDiff = xDiff;
        bestXPriority = SNAP_PRIORITY.center;
        snappedCx = bCx;
      }

      if (yDiff < thresh && compete(SNAP_PRIORITY.center, yDiff, bestYPriority, bestYDiff)) {
        bestYDiff = yDiff;
        bestYPriority = SNAP_PRIORITY.center;
        snappedCy = bCy;
      }
    }
  }

  // Snap to grid (higher priority than center)
  if (grid && grid > 0) {
    const gridCx = Math.round(box.cx / grid) * grid;
    const gridCy = Math.round(box.cy / grid) * grid;
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

  // Snap to layout grid
  if (layoutGridStep && layoutGridStep > 0) {
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
  const sizeSnap = snapSize(box.w, box.h, otherBounds, zoom);
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
