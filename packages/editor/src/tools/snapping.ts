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

export function snapPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  grid?: number,
): SnapResult {
  let snappedX = x;
  let snappedY = y;
  const guides: SnapGuide[] = [];

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
  for (let i = 0; i < otherBounds.length; i++) {
    const a = otherBounds[i]!;
    for (let j = i + 1; j < otherBounds.length; j++) {
      const b = otherBounds[j]!;
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
  for (const b of otherBounds) {
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
