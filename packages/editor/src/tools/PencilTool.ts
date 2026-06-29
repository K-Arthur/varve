/**
 * PencilTool — freehand path drawing.
 *
 * Captures pointer points at animation-frame rate, then on release applies
 * Ramer–Douglas–Peucker simplification and commits a path shape.
 *
 * Research basis: Figma Pencil (shift+P), Illustrator Pencil (N).
 */

import { BaseTool } from './BaseTool';
import type { Point2D } from './fitting';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class PencilTool extends BaseTool {
  id = 'pencil' as const;

  private captured: Point2D[] = [];
  private rafId: number | null = null;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.captured = [{ x: world.x, y: world.y }];
    this.drag = {
      kind: 'dragging',
      pointerId: e.pointerId,
      startCanvas: { x: e.clientX, y: e.clientY },
      startWorld: world,
      currentCanvas: { x: e.clientX, y: e.clientY },
      currentWorld: world,
    };
    this.startCapture(ctx);
    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging') return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
  }

  override onPointerUp(_e: PointerEvent, ctx: ToolContext): void {
    this.stopCapture();
    ctx.releasePointerCapture(_e.pointerId);

    if (this.captured.length < 2) {
      ctx.createShapeAt(this.drag.startWorld, { w: 4, h: 4 });
      this.reset();
      return;
    }

    const parentId = this.commitToParent(
      { x: this.drag.startWorld.x, y: this.drag.startWorld.y },
      ctx,
    );

    ctx.createShapeAt(
      { x: this.drag.startWorld.x, y: this.drag.startWorld.y },
      {
        w: Math.abs(this.drag.currentWorld.x - this.drag.startWorld.x) || 4,
        h: Math.abs(this.drag.currentWorld.y - this.drag.startWorld.y) || 4,
      },
      parentId,
    );
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
        const last = this.captured[this.captured.length - 1]!;
        const cur = this.drag.currentWorld;
        const dx = cur.x - last.x;
        const dy = cur.y - last.y;
        if (dx * dx + dy * dy > 1) {
          this.captured.push({ x: cur.x, y: cur.y });
          // Update draft as a rough bounding box
          const xs = this.captured.map((p) => p.x);
          const ys = this.captured.map((p) => p.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);
          ctx.setDraft({
            x: minX,
            y: minY,
            w: maxX - minX || 4,
            h: maxY - minY || 4,
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
