/**
 * HandTool — canvas panning.
 *
 * Drag pans the viewport. Grab/grabbing cursor.
 * Never creates shapes. Never changes selection.
 *
 * Research basis: Figma Hand tool (H), Illustrator hand tool (H),
 *                 Figma Space-bar spring-loaded pan.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class HandTool extends BaseTool {
  id = 'hand' as const;
  private startPan: { x: number; y: number } = { x: 0, y: 0 };
  private velocity: { x: number; y: number } | null = null;
  private rafId: number | null = null;
  private positionHistory: Array<{ x: number; y: number; time: number }> = [];

  override cursor(state: ToolCursorState): CursorSpec {
    return state === 'drag' ? { css: 'grabbing' } : { css: 'grab' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (e.button !== 0 && e.button !== 1) return { consumed: false };
    this.stopMomentum();
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
    this.positionHistory = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    const dx = this.drag.currentCanvas.x - this.drag.startCanvas.x;
    const dy = this.drag.currentCanvas.y - this.drag.startCanvas.y;
    ctx.setPan({ x: this.startPan.x + dx, y: this.startPan.y + dy });
    this.positionHistory.push({
      x: this.drag.currentCanvas.x,
      y: this.drag.currentCanvas.y,
      time: performance.now(),
    });
    if (this.positionHistory.length > 3) {
      this.positionHistory.shift();
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    const len = this.positionHistory.length;
    if (len >= 2) {
      const first = this.positionHistory[0]!;
      const last = this.positionHistory[len - 1]!;
      const dt = last.time - first.time;
      if (dt > 0) {
        const frameTime = 16;
        this.velocity = {
          x: ((last.x - first.x) / dt) * frameTime,
          y: ((last.y - first.y) / dt) * frameTime,
        };
      }
    }
    this.positionHistory = [];
    this.startMomentum(ctx);
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.stopMomentum();
    this.positionHistory = [];
  }

  private startMomentum(ctx: ToolContext): void {
    if (!this.velocity) return;
    const decay = 0.95;
    const threshold = 0.5;
    const tick = () => {
      if (!this.velocity) return;
      const vx = this.velocity.x * decay;
      const vy = this.velocity.y * decay;
      this.velocity = { x: vx, y: vy };
      if (Math.abs(vx) < threshold && Math.abs(vy) < threshold) {
        this.velocity = null;
        this.rafId = null;
        return;
      }
      ctx.setPan({ x: ctx.pan.x + vx, y: ctx.pan.y + vy });
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopMomentum(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.velocity = null;
  }
}
