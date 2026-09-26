/**
 * Multi-rect partial-redraw clip — the paint side of dirty-region pruning.
 *
 * Each merged dirty rect is cleared and refilled individually (the empty gaps
 * between distant invalidations keep their retained pixels), then a single
 * clip path covering exactly those rects is installed. The pruned replay
 * never touches the gaps, so retained and redrawn regions stay consistent.
 */

/**
 * A CSS-pixel rect in whole device pixels, grown outward.
 *
 * Clearing, filling, or clipping a fractional device rect covers its edge
 * pixels partially, so they become a blend of retained and repainted content
 * that no full redraw produces — a visible one-pixel seam (up to 97 levels
 * measured) along the dirty boundary.
 */
export function snapRectToDevicePixels(
  rect: { x: number; y: number; w: number; h: number },
  dpr: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.floor(rect.x * dpr);
  const y = Math.floor(rect.y * dpr);
  return {
    x,
    y,
    w: Math.ceil((rect.x + rect.w) * dpr) - x,
    h: Math.ceil((rect.y + rect.h) * dpr) - y,
  };
}

export function openMultiRectPartialClip(
  ctx: CanvasRenderingContext2D,
  screenRects: readonly { x: number; y: number; w: number; h: number }[],
  dpr: number,
  boardColor: string,
  applyCam: () => void,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The dirty rects already carry a 40px anti-aliasing margin, so the clear
  // region and the clip region are exactly the same rects — no extra margin
  // that would clear retained pixels the clip cannot repaint (a 1px seam).
  const deviceRects = screenRects.map((sr) => snapRectToDevicePixels(sr, dpr));
  for (const dr of deviceRects) {
    ctx.clearRect(dr.x, dr.y, dr.w, dr.h);
    ctx.fillStyle = boardColor;
    ctx.fillRect(dr.x, dr.y, dr.w, dr.h);
  }
  ctx.save();
  ctx.beginPath();
  for (const dr of deviceRects) {
    ctx.rect(dr.x, dr.y, dr.w, dr.h);
  }
  ctx.clip();
  applyCam();
}

/** Single-rect partial clip — the pre-pruning path (union of all inputs). */
export function openUnionPartialClip(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  dpr: number,
  boardColor: string,
  applyCam: () => void,
): void {
  // The union path replays every visible node under this clip, so growing it
  // to whole device pixels cannot expose an unreplayed band.
  const { x: dx, y: dy, w: dw, h: dh } = snapRectToDevicePixels(rect, dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(dx, dy, dw, dh);
  ctx.fillStyle = boardColor;
  ctx.fillRect(dx, dy, dw, dh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  applyCam();
}

/** Full-canvas redraw (the fallback path). */
export function openFullRedraw(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  boardColor: string,
  applyCam: () => void,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = boardColor;
  ctx.fillRect(0, 0, canvasW, canvasH);
  applyCam();
}
