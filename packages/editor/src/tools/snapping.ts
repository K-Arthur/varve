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

const SNAP_THRESHOLD = 5;

const SNAP_RANGE_PX = 200;

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

/** AABB overlap check in screen space. */
function intersect(
  a: ReturnType<typeof screenBounds>,
  b: ReturnType<typeof screenBounds>,
): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.rx + b.rx + SNAP_RANGE_PX &&
    Math.abs(a.cy - b.cy) < a.ry + b.ry + SNAP_RANGE_PX
  );
}

/**
 * Filter snap targets by spatial proximity and sibling preference.
 * Only targets whose screen-space AABB intersects the dragged object's
 * AABB expanded by SNAP_RANGE_PX in each direction are included.
 */
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
    // Priority: siblings score 0, non-siblings score 1 (lower = preferred)
    const targetParent = parentIndex.get(entry.nodeId) ?? null;
    const priority = draggedParent !== null && targetParent === draggedParent ? 0 : 1;
    results.push({ ...entry.bounds, priority });
  }

  // Sort by priority (siblings first), then by x distance for determinism
  results.sort((a, b) => a.priority - b.priority);
  return results.map(({ priority: _, ...bounds }) => bounds);
}

export function snapPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  grid?: number,
  snapExcludedIds?: Set<string>,
): SnapResult {
  let snappedX = x;
  let snappedY = y;
  const guides: SnapGuide[] = [];

  // Filter out snap-excluded targets
  const activeBounds =
    snapExcludedIds && snapExcludedIds.size > 0
      ? otherBounds.filter((_, i) => !snapExcludedIds.has(String(i)))
      : otherBounds;

  const cx = x + w / 2;
  const cy = y + h / 2;
  const edges = { left: x, right: x + w, centerX: cx, top: y, bottom: y + h, centerY: cy };

  // Grid snapping
  if (grid && grid > 0) {
    const snappedGridX = Math.round(x / grid) * grid;
    const snappedGridY = Math.round(y / grid) * grid;
    if (Math.abs(snappedGridX - x) < SNAP_THRESHOLD) {
      snappedX = snappedGridX;
      guides.push({
        axis: 'vertical',
        position: snappedGridX,
        label: `${snappedGridX}px`,
        type: 'edge',
      });
    }
    if (Math.abs(snappedGridY - y) < SNAP_THRESHOLD) {
      snappedY = snappedGridY;
      guides.push({
        axis: 'horizontal',
        position: snappedGridY,
        label: `${snappedGridY}px`,
        type: 'edge',
      });
    }
  }

  // Mid-point snapping (before edge/center to allow edge override)
  for (let i = 0; i < activeBounds.length; i++) {
    const a = activeBounds[i]!;
    for (let j = i + 1; j < activeBounds.length; j++) {
      const b = activeBounds[j]!;
      const aCX = a.x + a.w / 2;
      const aCY = a.y + a.h / 2;
      const bCX = b.x + b.w / 2;
      const bCY = b.y + b.h / 2;
      const midX = (aCX + bCX) / 2;
      const midY = (aCY + bCY) / 2;
      if (Math.abs(cx - midX) < SNAP_THRESHOLD) {
        snappedX = x - (cx - midX);
        guides.push({ axis: 'vertical', position: midX, type: 'midpoint', label: 'mid' });
      }
      if (Math.abs(cy - midY) < SNAP_THRESHOLD) {
        snappedY = y - (cy - midY);
        guides.push({ axis: 'horizontal', position: midY, type: 'midpoint', label: 'mid' });
      }
    }
  }

  // Object snapping
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
      if (Math.abs(diff) < SNAP_THRESHOLD) {
        snappedX = x - diff;
        const snapType = key === 'centerX' ? 'center' : 'edge';
        guides.push({
          axis: 'vertical',
          position: bEdges[key],
          distance: Math.abs(diff),
          type: snapType,
        });
        break;
      }
    }

    for (const key of ['top', 'centerY', 'bottom'] as const) {
      const diff = edges[key] - bEdges[key];
      if (Math.abs(diff) < SNAP_THRESHOLD) {
        snappedY = y - diff;
        const snapType = key === 'centerY' ? 'center' : 'edge';
        guides.push({
          axis: 'horizontal',
          position: bEdges[key],
          distance: Math.abs(diff),
          type: snapType,
        });
        break;
      }
    }
  }

  // D-01: Equal-gap distribution snapping — when the dragged object is between
  // two other objects on the same axis, snap to maintain equal spacing.
  const xGaps: { mid: number; gap: number }[] = [];
  const yGaps: { mid: number; gap: number }[] = [];
  const draggedCx = cx;
  const draggedCy = cy;
  for (const a of otherBounds) {
    for (const b of otherBounds) {
      if (a === b) continue;
      if (!a || !b) continue;
      const aR = a.x + a.w;
      const bL = b.x;
      const gapX = bL - aR;
      if (gapX > 0 && aR < draggedCx && bL > draggedCx) {
        xGaps.push({ mid: (aR + bL) / 2, gap: gapX });
      }
      const aB = a.y + a.h;
      const bT = b.y;
      const gapY = bT - aB;
      if (gapY > 0 && aB < draggedCy && bT > draggedCy) {
        yGaps.push({ mid: (aB + bT) / 2, gap: gapY });
      }
    }
  }
  if (xGaps.length > 0) {
    const best = xGaps.reduce((a, b) =>
      Math.abs(a.gap - (a.mid - draggedCx)) < Math.abs(b.gap - (b.mid - draggedCx)) ? a : b,
    );
    const idealCx = best.mid;
    if (Math.abs(cx - idealCx) < SNAP_THRESHOLD * 3) {
      snappedX = x - (cx - idealCx);
      guides.push({
        axis: 'vertical',
        position: idealCx,
        type: 'spacing',
        label: `${Math.round(best.gap)}px`,
      });
    }
  }
  if (yGaps.length > 0) {
    const best = yGaps.reduce((a, b) =>
      Math.abs(a.gap - (a.mid - draggedCy)) < Math.abs(b.gap - (b.mid - draggedCy)) ? a : b,
    );
    const idealCy = best.mid;
    if (Math.abs(cy - idealCy) < SNAP_THRESHOLD * 3) {
      snappedY = y - (cy - idealCy);
      guides.push({
        axis: 'horizontal',
        position: idealCy,
        type: 'spacing',
        label: `${Math.round(best.gap)}px`,
      });
    }
  }

  return { x: snappedX, y: snappedY, guides };
}

export function snapSize(
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
): { w: number; h: number; matched: boolean; guide?: SnapGuide } {
  const threshold = 5;
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
