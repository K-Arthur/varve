export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasBounds extends CanvasPoint {
  width: number;
  height: number;
}

/** Coordinates are CSS pixels relative to the owned canvas, not document units. */
export function assertCanvasGesture(
  box: CanvasBounds | null,
  from: CanvasPoint,
  to: CanvasPoint,
  outsideEndReason?: string,
): asserts box is CanvasBounds {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) {
    throw new Error(
      'Canvas gesture requires the owned artwork canvas bounds; no auxiliary fallback',
    );
  }
  if (box.width <= 0 || box.height <= 0) {
    throw new Error('Canvas gesture requires a non-zero artwork canvas');
  }
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) {
    throw new TypeError('Canvas gesture coordinates must be finite CSS pixels');
  }
  if (outsideEndReason !== undefined && outsideEndReason.trim().length < 20) {
    throw new Error('An intentional outside-canvas pan needs an explicit reason');
  }
  const contains = (point: CanvasPoint) =>
    point.x >= 0 && point.y >= 0 && point.x < box.width && point.y < box.height;
  if (!contains(from) || (!outsideEndReason && !contains(to))) {
    throw new Error(
      `Canvas gesture outside artwork bounds ${box.width}x${box.height}: ` +
        `(${from.x}, ${from.y}) -> (${to.x}, ${to.y}). ` +
        'Use measured visible coordinates; an intentional pan must use dragBeyondCanvas.',
    );
  }
}
