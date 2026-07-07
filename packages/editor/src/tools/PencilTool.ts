/**
 * PencilTool — freehand path drawing.
 *
 * Captures pointer points at animation-frame rate, then on release applies
 * Ramer-Douglas-Peucker simplification, Schneider Bezier curve fitting,
 * and commits a path shape with proper handles.
 *
 * Research basis: Figma Pencil (shift+P), Illustrator Pencil (N).
 *                 Schneider, P. Graphics Gems (1990).
 */

import { BaseTool } from './BaseTool';
import type { Point2D } from './fitting';
import { fitPathToBeziers, simplifyPoints } from './fitting';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class PencilTool extends BaseTool {
  id = 'pencil' as const;

  private captured: Point2D[] = [];
  private rafId: number | null = null;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.captured = [{ x: world.x, y: world.y }];
    this.startCapture(ctx);
    return result;
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging') return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    this.stopCapture();

    if (this.captured.length < 2) {
      ctx.createShapeAt(this.drag.startWorld, { w: 4, h: 4 });
      super.onPointerUp(e, ctx);
      this.reset();
      return;
    }

    // Simplify with zoom-aware epsilon (2 screen pixels → world units)
    const SCREEN_PX_EPSILON = 2;
    const epsilon = SCREEN_PX_EPSILON / ctx.zoom;
    const simplified = simplifyPoints(this.captured, epsilon);
    const fitted = fitPathToBeziers(simplified);
    const pathPoints = fitted.map((p) => ({
      x: p.x,
      y: p.y,
      handleIn: p.handleIn as [number, number] | null,
      handleOut: p.handleOut as [number, number] | null,
    }));

    const parentId = this.commitToParent(
      { x: this.drag.startWorld.x, y: this.drag.startWorld.y },
      ctx,
    );

    ctx.createShapeAt(
      { x: this.drag.startWorld.x, y: this.drag.startWorld.y },
      undefined,
      parentId,
      pathPoints,
    );
    super.onPointerUp(e, ctx);
    this.reset();
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.stopCapture();
    this.reset();
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.stopCapture();
      this.reset();
      ctx.setDraft(null);
      return true;
    }
    return false;
  }

  private startCapture(ctx: ToolContext): void {
    const capture = () => {
      if (this.drag.kind !== 'dragging') return;
      if (this.captured.length > 0) {
        const last = this.captured[this.captured.length - 1] as Point2D;
        const cur = this.drag.currentWorld;
        const dx = cur.x - last.x;
        const dy = cur.y - last.y;
        if (dx * dx + dy * dy > 1) {
          this.captured.push({ x: cur.x, y: cur.y });
          ctx.setDraft({
            kind: 'freehand',
            points: this.captured,
            label: `${this.captured.length} pts`,
          });
        }
      }
      this.rafId = requestAnimationFrame(capture);
    };
    this.rafId = requestAnimationFrame(capture);
  }

  private stopCapture(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private reset(): void {
    this.captured = [];
    this.drag = {
      kind: 'idle',
      pointerId: -1,
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 0, y: 0 },
      currentWorld: { x: 0, y: 0 },
    };
  }
}
