export interface CircleLayoutOptions {
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  /** If true, rotate each item to face outward from center */
  rotateItems: boolean;
}

export interface CircleLayoutItem {
  id: string;
  width: number;
  height: number;
}

export interface CircleLayoutResult {
  id: string;
  x: number;
  y: number;
  rotation?: number;
}

/**
 * Arrange items evenly around a circle.
 * Items are positioned so their center falls on the circle.
 */
export function computeCircleLayout(
  items: CircleLayoutItem[],
  options: Partial<CircleLayoutOptions>,
): CircleLayoutResult[] {
  if (items.length === 0) return [];

  const {
    centerX = 0,
    centerY = 0,
    radius = 200,
    startAngle = -Math.PI / 2,
    rotateItems = false,
  } = options;

  const count = items.length;
  const angleStep = (2 * Math.PI) / count;

  return items.map((item, i) => {
    const angle = startAngle + i * angleStep;
    const cx = centerX + radius * Math.cos(angle);
    const cy = centerY + radius * Math.sin(angle);
    const x = cx - item.width / 2;
    const y = cy - item.height / 2;

    return {
      id: item.id,
      x,
      y,
      ...(rotateItems ? { rotation: (angle * 180) / Math.PI + 90 } : {}),
    };
  });
}
