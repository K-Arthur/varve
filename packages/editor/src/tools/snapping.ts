export interface SnapGuide {
  axis: 'horizontal' | 'vertical';
  position: number;
  label?: string;
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
      guides.push({ axis: 'vertical', position: snappedGridX, label: `${snappedGridX}px` });
    }
    if (Math.abs(snappedGridY - y) < SNAP_THRESHOLD) {
      snappedY = snappedGridY;
      guides.push({ axis: 'horizontal', position: snappedGridY, label: `${snappedGridY}px` });
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
        guides.push({ axis: 'vertical', position: bEdges[key] });
        break;
      }
    }

    for (const key of ['top', 'centerY', 'bottom'] as const) {
      const diff = edges[key] - bEdges[key];
      if (Math.abs(diff) < SNAP_THRESHOLD) {
        snappedY = y - diff;
        guides.push({ axis: 'horizontal', position: bEdges[key] });
        break;
      }
    }
  }

  return { x: snappedX, y: snappedY, guides };
}
