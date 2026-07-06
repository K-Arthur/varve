export interface SnapGuide {
  axis: 'horizontal' | 'vertical';
  position: number;
  label?: string;
  distance?: number;
  type?: 'edge' | 'center' | 'midpoint' | 'spacing' | 'rotation' | 'size-match';
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

  if (grid && grid > 0) {
    const snappedGridX = Math.round(x / grid) * grid;
    const snappedGridY = Math.round(y / grid) * grid;
    if (Math.abs(snappedGridX - x) < thresh) {
      snappedX = snappedGridX;
      guides.push({ axis: 'vertical', position: snappedGridX, label: `${snappedGridX}px`, type: 'edge' });
    }
    if (Math.abs(snappedGridY - y) < thresh) {
      snappedY = snappedGridY;
      guides.push({ axis: 'horizontal', position: snappedGridY, label: `${snappedGridY}px`, type: 'edge' });
    }
  }

  if (options.layoutGridStep && options.layoutGridStep > 0) {
    const step = options.layoutGridStep;
    const gridX = Math.round(x / step) * step;
    const gridY = Math.round(y / step) * step;
    if (Math.abs(gridX - x) < thresh) snappedX = gridX;
    if (Math.abs(gridY - y) < thresh) snappedY = gridY;
  }

  for (let i = 0; i < activeBounds.length; i++) {
    const a = activeBounds[i]!;
    for (let j = i + 1; j < activeBounds.length; j++) {
      const b = activeBounds[j]!;
      const midX = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
      const midY = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
      if (Math.abs(cx - midX) < thresh) {
        snappedX = x - (cx - midX);
        guides.push({ axis: 'vertical', position: midX, type: 'midpoint', label: 'mid' });
      }
      if (Math.abs(cy - midY) < thresh) {
        snappedY = y - (cy - midY);
        guides.push({ axis: 'horizontal', position: midY, type: 'midpoint', label: 'mid' });
      }
    }
  }

  let bestXDiff = Infinity;
  let bestXSnap = snappedX;
  let bestXGuide: SnapGuide | null = null;
  let bestYDiff = Infinity;
  let bestYSnap = snappedY;
  let bestYGuide: SnapGuide | null = null;

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
      if (Math.abs(diff) < thresh && Math.abs(diff) < bestXDiff) {
        bestXDiff = Math.abs(diff);
        bestXSnap = x - diff;
        bestXGuide = {
          axis: 'vertical',
          position: bEdges[key],
          distance: Math.abs(diff),
          type: key === 'centerX' ? 'center' : 'edge',
        };
      }
    }

    for (const key of ['top', 'centerY', 'bottom'] as const) {
      const diff = edges[key] - bEdges[key];
      if (Math.abs(diff) < thresh && Math.abs(diff) < bestYDiff) {
        bestYDiff = Math.abs(diff);
        bestYSnap = y - diff;
        bestYGuide = {
          axis: 'horizontal',
          position: bEdges[key],
          distance: Math.abs(diff),
          type: key === 'centerY' ? 'center' : 'edge',
        };
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
    const hold = tryStickyAxis(x, x, session.stickyX.guidePosition, session.stickyX, thresh, release, true);
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
    const hold = tryStickyAxis(y, y, session.stickyY.guidePosition, session.stickyY, thresh, release, true);
    if (hold.snapped) snappedY = hold.coord;
    else session = { ...session, stickyY: null };
  }

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
    if (Math.abs(cx - best.mid) < thresh * 3) {
      snappedX = x - (cx - best.mid);
      guides.push({ axis: 'vertical', position: best.mid, type: 'spacing', label: `${Math.round(best.gap)}px` });
    }
  }
  if (yGaps.length > 0) {
    const best = yGaps.reduce((a, b) =>
      Math.abs(a.gap - (a.mid - cy)) < Math.abs(b.gap - (b.mid - cy)) ? a : b,
    );
    if (Math.abs(cy - best.mid) < thresh * 3) {
      snappedY = y - (cy - best.mid);
      guides.push({ axis: 'horizontal', position: best.mid, type: 'spacing', label: `${Math.round(best.gap)}px` });
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
