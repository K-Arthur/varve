/**
 * Multi-rect partial-redraw clip — the paint side of dirty-region pruning.
 *
 * Each merged dirty rect is cleared and refilled individually (the empty gaps
 * between distant invalidations keep their retained pixels), then a single
 * clip path covering exactly those rects is installed. The pruned replay
 * never touches the gaps, so retained and redrawn regions stay consistent.
 */

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
  for (const sr of screenRects) {
    const dx = sr.x * dpr;
    const dy = sr.y * dpr;
    const dw = sr.w * dpr;
    const dh = sr.h * dpr;
    ctx.clearRect(dx, dy, dw, dh);
    ctx.fillStyle = boardColor;
    ctx.fillRect(dx, dy, dw, dh);
  }
  ctx.save();
  ctx.beginPath();
  for (const sr of screenRects) {
    ctx.rect(sr.x * dpr, sr.y * dpr, sr.w * dpr, sr.h * dpr);
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
  const dx = rect.x * dpr;
  const dy = rect.y * dpr;
  const dw = rect.w * dpr;
  const dh = rect.h * dpr;
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
