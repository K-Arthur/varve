/**
 * PageTool — explicit page-geometry mode for the shared multipage canvas
 * (M6, ADR-0144/0145).
 *
 * Click on a page's trim activates it. Dragging the trim moves the page on
 * the pasteboard: placement metadata only (ADR-0124), so page-local content
 * coordinates never change and every child keeps its position on the page.
 * Dragging a corner of the ACTIVE page's trim resizes the page without
 * scaling its content. Pasteboard clicks are inert — node selection stays
 * with SelectTool.
 *
 * Gesture states: idle → (click page → activate) | (drag trim → move page)
 *               | (drag corner → resize page).
 */

import type { NodeId, PagePlacement } from '@varve/scene';
import { resolvePagePlacement, worldToPageAtPoint } from '@varve/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState, ToolId } from './types';

/** Minimum page trim size (world px) enforced by the resize gesture. */
export const MIN_PAGE_SIZE = 50;
/** Corner handle hit tolerance in CSS px (screen-constant). */
const HANDLE_TOLERANCE_CSS_PX = 10;

type Corner = readonly [1 | -1, 1 | -1];

const CORNERS: readonly Corner[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export type PageToolGesture =
  | { kind: 'idle' }
  | { kind: 'move'; pageId: NodeId; startPlacement: PagePlacement }
  | { kind: 'resize'; pageId: NodeId; startSize: { w: number; h: number }; corner: Corner };

/**
 * Resolve the trim-corner of `bounds` under `world` within the tolerance
 * (world px). Returns the corner unit vector, or null.
 */
export function cornerUnderPoint(
  bounds: { x: number; y: number; w: number; h: number },
  world: { x: number; y: number },
  toleranceWorld: number,
): Corner | null {
  const { x, y, w, h } = bounds;
  const candidates: Array<{ corner: Corner; px: number; py: number }> = CORNERS.map((corner) => ({
    corner,
    px: x + (corner[0] === 1 ? w : 0),
    py: y + (corner[1] === 1 ? h : 0),
  }));
  let best: { corner: Corner; d: number } | null = null;
  for (const c of candidates) {
    const d = Math.hypot(world.x - c.px, world.y - c.py);
    if (d <= toleranceWorld && (best === null || d < best.d)) {
      best = { corner: c.corner, d };
    }
  }
  return best?.corner ?? null;
}

export class PageTool extends BaseTool {
  readonly id: ToolId = 'page';

  private gesture: PageToolGesture = { kind: 'idle' };

  override onActivate(ctx: ToolContext): void {
    ctx.announce('Page tool — click a page to activate it, drag it to move it on the pasteboard');
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.gesture = { kind: 'idle' };
  }

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'move' };
    if (state === 'resize') return { css: 'nwse-resize' };
    return { css: 'default' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag = {
      kind: 'dragging',
      pointerId: e.pointerId,
      startCanvas: canvas,
      startWorld: world,
      currentCanvas: canvas,
      currentWorld: world,
    };

    // Corner resize only for the ACTIVE page — its handles are visible.
    const activePage = ctx.document.pages?.find((p) => p.id === ctx.document.activePageId);
    if (activePage) {
      const placed = resolvePageTrim(ctx, activePage);
      if (placed) {
        const tolerance = HANDLE_TOLERANCE_CSS_PX / ctx.zoom;
        const corner = cornerUnderPoint(placed, world, tolerance);
        if (corner) {
          this.gesture = {
            kind: 'resize',
            pageId: activePage.id,
            startSize: { w: activePage.width, h: activePage.height },
            corner,
          };
          ctx.beginTransaction();
          return { consumed: true, captured: true };
        }
      }
    }

    const pageAt = worldToPageAtPoint(ctx.document, world);
    if (pageAt) {
      ctx.setActivePage?.(pageAt.pageId);
      const page = ctx.document.pages?.find((p) => p.id === pageAt.pageId);
      const startPlacement =
        page?.placement ?? resolvePagePlacement(ctx.document, pageAt.pageId) ?? { x: 0, y: 0 };
      this.gesture = { kind: 'move', pageId: pageAt.pageId, startPlacement };
      ctx.beginTransaction();
      return { consumed: true, captured: true };
    }

    this.gesture = { kind: 'idle' };
    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    const g = this.gesture;
    if (g.kind === 'idle') return;
    const totalDelta = ctx.canvasDeltaToWorld(
      this.drag.currentCanvas.x - this.drag.startCanvas.x,
      this.drag.currentCanvas.y - this.drag.startCanvas.y,
    );
    if (g.kind === 'move') {
      ctx.movePageOnPasteboard?.(
        g.pageId,
        g.startPlacement.x + totalDelta.dx,
        g.startPlacement.y + totalDelta.dy,
      );
    } else {
      const [dx, dy] = g.corner;
      const w = Math.max(MIN_PAGE_SIZE, g.startSize.w + dx * totalDelta.dx);
      const h = Math.max(MIN_PAGE_SIZE, g.startSize.h + dy * totalDelta.dy);
      ctx.resizePage?.(g.pageId, w, h);
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.commitTransaction();
    this.gesture = { kind: 'idle' };
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.abortTransaction();
    this.gesture = { kind: 'idle' };
  }
}

/**
 * Placed trim bounds of a page in world coordinates via the canonical
 * resolver (explicit placement wins; otherwise the deterministic auto
 * layout). Null when the page is unknown.
 */
function resolvePageTrim(
  ctx: ToolContext,
  page: { id: NodeId; width: number; height: number },
): { x: number; y: number; w: number; h: number } | null {
  const placement = resolvePagePlacement(ctx.document, page.id);
  if (!placement) return null;
  return { x: placement.x, y: placement.y, w: page.width, h: page.height };
}
