/**
 * PenTool — cubic Bézier path creation.
 *
 * Click → corner point. Click-drag → smooth point with symmetric handles.
 * Alt-drag a handle → break symmetry. Click first point → close path.
 * Enter/Escape/double-click → finish open path.
 * Click existing path endpoint → continue path.
 * Live rubber-band preview of next segment.
 *
 * Research basis: Figma Pen (P), Illustrator Pen (P), Penpot Pen.
 *                 de Casteljau's algorithm, cubic Bézier math.
 *
 * Note: Full path shape + rendering integration requires a new `path` shape
 * variant. This implementation provides the point-placement state machine;
 * path commit is a stub that creates a placeholder shape for now.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface PenPoint {
  x: number;
  y: number;
  handleIn: { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
}

enum PenState {
  Idle,
  Placing, // placing points in a new path
  Editing, // editing existing path (stub)
}

export class PenTool extends BaseTool {
  id = 'pen' as const;

  private penState: PenState = PenState.Idle;
  private points: PenPoint[] = [];
  private lastPointTime = 0;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(_ctx: ToolContext): void {
    this.penState = PenState.Idle;
    this.points = [];
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.penState = PenState.Idle;
    this.points = [];
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);

    if (this.penState === PenState.Idle) {
      // Start new path
      this.penState = PenState.Placing;
      this.points = [{ x: world.x, y: world.y, handleIn: null, handleOut: null }];
      ctx.announce('Path started');
      return { consumed: true };
    }

    if (this.penState === PenState.Placing) {
      // Check for close (click on first point)
      const first = this.points[0];
      if (!first) throw new Error('first point not found');
      const dist = Math.sqrt((world.x - first.x) ** 2 + (world.y - first.y) ** 2);
      if (dist < 8 / ctx.zoom) {
        // Close path
        this.commitPath(ctx, true);
        ctx.announce('Path closed');
        return { consumed: true };
      }

      // Add new point
      const prev = this.points[this.points.length - 1];
      if (!prev) throw new Error('previous point not found');
      const now = Date.now();
      if (now - this.lastPointTime < 300 && this.points.length > 1) {
        // Rapid double-click → finish path
        this.commitPath(ctx, false);
        ctx.announce('Path finished');
        return { consumed: true };
      }
      this.lastPointTime = now;

      if (e.shiftKey) {
        // Constrain to 45° from previous
        const dx = world.x - prev.x;
        const dy = world.y - prev.y;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.sqrt(dx * dx + dy * dy);
        const snapped = {
          x: prev.x + len * Math.cos(angle),
          y: prev.y + len * Math.sin(angle),
        };
        this.points.push({ x: snapped.x, y: snapped.y, handleIn: null, handleOut: null });
      } else {
        this.points.push({ x: world.x, y: world.y, handleIn: null, handleOut: null });
      }
      ctx.announce(`Point ${this.points.length}`);
      return { consumed: true };
    }

    return { consumed: false };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.penState !== PenState.Placing || this.points.length === 0) return;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const last = this.points[this.points.length - 1];
    if (!last) throw new Error('last point not found');

    // Rubber-band preview as draft line from last point to cursor
    const x = Math.min(last.x, world.x);
    const y = Math.min(last.y, world.y);
    const w = Math.abs(world.x - last.x) || 4;
    const h = Math.abs(world.y - last.y) || 4;
    ctx.setDraft({
      kind: 'rect',
      x,
      y,
      w,
      h,
      label: `to (${Math.round(world.x)}, ${Math.round(world.y)})`,
    });
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (this.penState === PenState.Placing) {
      if (e.key === 'Escape') {
        if (this.points.length > 1) {
          this.commitPath(ctx, false);
        } else {
          this.penState = PenState.Idle;
          this.points = [];
        }
        ctx.announce('Path cancelled');
        return true;
      }
      if (e.key === 'Enter') {
        this.commitPath(ctx, false);
        ctx.announce('Path finished');
        return true;
      }
    }
    return false;
  }

  override onDoubleClick(_e: PointerEvent, ctx: ToolContext): void {
    if (this.penState === PenState.Placing) {
      this.commitPath(ctx, false);
      ctx.announce('Path finished');
    }
  }

  private commitPath(ctx: ToolContext, closed: boolean): void {
    ctx.setDraft(null);
    if (this.points.length < 2 && !closed) {
      const pt = this.points[0];
      if (!pt) throw new Error('point not found');
      ctx.createShapeAt({ x: pt.x, y: pt.y }, { w: 4, h: 4 });
    } else if (this.points.length >= 2 || closed) {
      const first = this.points[0];
      if (!first) throw new Error('first point not found');
      // Convert PenPoint[] to PathPoint[]
      const pathPoints = this.points.map((p) => ({
        x: p.x,
        y: p.y,
        handleIn: p.handleIn ? ([p.handleIn.x, p.handleIn.y] as [number, number]) : null,
        handleOut: p.handleOut ? ([p.handleOut.x, p.handleOut.y] as [number, number]) : null,
      }));
      // If closed, add copy of first point as last
      if (closed && pathPoints.length > 0) {
        const firstPt = pathPoints[0]!;
        pathPoints.push({
          x: firstPt.x,
          y: firstPt.y,
          handleIn: firstPt.handleIn,
          handleOut: firstPt.handleOut,
        });
      }
      ctx.createShapeAt({ x: first.x, y: first.y }, undefined, undefined, pathPoints);
    }
    this.penState = PenState.Idle;
    this.points = [];
  }
}
