import type { PenConstructionDraft, PenConstructionPoint } from '../tools/types';

function controlPoint(
  point: PenConstructionPoint,
  handle: { x: number; y: number } | null,
): { x: number; y: number } {
  return {
    x: point.x + (handle?.x ?? 0),
    y: point.y + (handle?.y ?? 0),
  };
}

function traceSegment(
  ctx: CanvasRenderingContext2D,
  from: PenConstructionPoint,
  to: PenConstructionPoint,
): void {
  const out = controlPoint(from, from.handleOut);
  const incoming = controlPoint(to, to.handleIn);
  if (from.handleOut || to.handleIn) {
    ctx.bezierCurveTo(out.x, out.y, incoming.x, incoming.y, to.x, to.y);
  } else {
    ctx.lineTo(to.x, to.y);
  }
}

function traceConstructionPath(ctx: CanvasRenderingContext2D, draft: PenConstructionDraft): void {
  const first = draft.points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < draft.points.length; index += 1) {
    const point = draft.points[index];
    if (point) traceSegment(ctx, draft.points[index - 1]!, point);
  }
  if (draft.closedPreview && draft.points.length > 1) {
    traceSegment(ctx, draft.points[draft.points.length - 1]!, first);
  }
  ctx.stroke();
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  point: PenConstructionPoint,
  handle: { x: number; y: number } | null,
  zoom: number,
): void {
  if (!handle) return;
  const end = controlPoint(point, handle);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(end.x, end.y, 4 / zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Draw the live Pen artwork, controls, anchors, and close affordance. */
export function drawPenConstructionPreview(
  ctx: CanvasRenderingContext2D,
  draft: PenConstructionDraft,
  zoom: number,
  accentColor: string,
): void {
  if (draft.points.length === 0) return;
  const safeZoom = Math.max(0.0001, zoom);
  const first = draft.points[0]!;
  const active = draft.points[draft.activePointIndex] ?? draft.points[draft.points.length - 1]!;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2 / safeZoom;
  ctx.setLineDash([]);
  traceConstructionPath(ctx, draft);

  // The future segment is intentionally separate from the segment being
  // completed. It is a lightweight rubber-band preview, never a replacement
  // for the actual cubic geometry above.
  if (draft.pointer && !draft.isDragging && !draft.closedPreview) {
    const last = draft.points[draft.points.length - 1]!;
    const out = controlPoint(last, last.handleOut);
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 1.5 / safeZoom;
    ctx.setLineDash([5 / safeZoom, 5 / safeZoom]);
    ctx.beginPath();
    ctx.moveTo(out.x, out.y);
    ctx.lineTo(draft.pointer.x, draft.pointer.y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.fillStyle = accentColor;
  ctx.lineWidth = 1 / safeZoom;
  for (const point of draft.points) {
    drawHandle(ctx, point, point.handleIn, safeZoom);
    drawHandle(ctx, point, point.handleOut, safeZoom);
  }

  for (let index = 0; index < draft.points.length; index += 1) {
    const point = draft.points[index]!;
    const isActive = point === active;
    const isCloseTarget = point === first && draft.closedPreview;
    const size = (isActive ? 5 : 4) / safeZoom;
    ctx.save();
    // Canvas2D does not resolve CSS var() values consistently across the
    // browser/WebKitGTK versions Varve supports; keep the inactive anchor
    // visibly filled without depending on CSS parsing in a canvas context.
    ctx.fillStyle = isActive ? accentColor : 'rgba(26, 35, 45, 0.96)';
    ctx.strokeStyle = isCloseTarget ? '#ffffff' : accentColor;
    ctx.lineWidth = (isCloseTarget ? 2 : 1.25) / safeZoom;
    ctx.beginPath();
    if (point.handleIn || point.handleOut) {
      ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    } else {
      ctx.rect(point.x - size, point.y - size, size * 2, size * 2);
    }
    ctx.fill();
    ctx.stroke();
    if (isCloseTarget) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 9 / safeZoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
