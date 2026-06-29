/**
 * ZoomTool — canvas zoom.
 *
 * Click to zoom in at pointer (1.25x). Alt+click to zoom out (0.8x).
 * Drag to marquee-zoom to region.
 * Never creates shapes. Never changes selection.
 *
 * Research basis: Figma Zoom tool (Z), Illustrator zoom (Z).
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class ZoomTool extends BaseTool {
  id = 'zoom' as const;
  private marqueeStart: { x: number; y: number } | null = null;

  override cursor(state: ToolCursorState): CursorSpec {
    return state === 'drag' ? { css: 'crosshair' } : { css: 'zoom-in' };
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
    this.marqueeStart = null;
    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    const dx = Math.abs(this.drag.currentCanvas.x - this.drag.startCanvas.x);
    const dy = Math.abs(this.drag.currentCanvas.y - this.drag.startCanvas.y);
    if (dx > 5 || dy > 5) {
      this.marqueeStart = this.drag.startWorld;
      const rect = this.computeDragRect(ctx);
      ctx.setDraft({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    if (this.marqueeStart) {
      const rect = this.computeDragRect(ctx);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const canvasW = window.innerWidth;
      const canvasH = window.innerHeight;
      if (rect.w > 0 && rect.h > 0 && canvasW > 0 && canvasH > 0) {
        const zoomX = canvasW / rect.w;
        const zoomY = canvasH / rect.h;
        const newZoom = Math.min(zoomX, zoomY) * 0.9;
        ctx.setZoom(Math.max(0.1, Math.min(10, newZoom)));
        ctx.setPan({
          x: -cx * newZoom + canvasW / 2,
          y: -cy * newZoom + canvasH / 2,
        });
      }
    } else {
      const factor = ctx.altKey ? 0.8 : 1.25;
      ctx.setZoom(Math.max(0.1, Math.min(10, ctx.zoom * factor)));
    }
    this.marqueeStart = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.marqueeStart = null;
  }

  override onKeyDown(e: KeyboardEvent, _ctx: ToolContext): boolean {
    if (e.key === 'Escape') return true;
    return false;
  }
}
