/**
 * HandTool — canvas panning.
 *
 * Drag pans the viewport. Grab/grabbing cursor.
 * Never creates shapes. Never changes selection.
 *
 * Research basis: Figma Hand tool (H), Illustrator hand tool (H),
 *                 Figma Space-bar spring-loaded pan.
 */
import type { ToolContext, ToolCursorState, CursorSpec, GestureResult } from './types';
import { BaseTool } from './BaseTool';

export class HandTool extends BaseTool {
  id = 'hand' as const;
  private startPan: { x: number; y: number } = { x: 0, y: 0 };

  override cursor(state: ToolCursorState): CursorSpec {
    return state === 'drag' ? { css: 'grabbing' } : { css: 'grab' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const canvas = { x: e.clientX, y: e.clientY };
    this.drag = {
      kind: 'dragging',
      pointerId: e.pointerId,
      startCanvas: canvas,
      startWorld: { x: 0, y: 0 },
      currentCanvas: canvas,
      currentWorld: { x: 0, y: 0 },
    };
    this.startPan = { ...ctx.pan };
    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    const dx = this.drag.currentCanvas.x - this.drag.startCanvas.x;
    const dy = this.drag.currentCanvas.y - this.drag.startCanvas.y;
    ctx.setPan({ x: this.startPan.x + dx, y: this.startPan.y + dy });
  }

  override onDragEnd(_ctx: ToolContext): void {
    // nothing to commit
  }

  override onDragCancel(_ctx: ToolContext): void {
    // nothing to revert
  }
}
