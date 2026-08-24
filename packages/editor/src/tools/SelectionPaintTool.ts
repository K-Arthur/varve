import { type AreaSelection, type MaskBrushStamp, paintSelectionMask } from '@varve/engine';
import type { CursorSpec, GestureResult, Tool, ToolContext, ToolCursorState } from './types';

/**
 * Quick-mask editor for the analytical area selection.
 *
 * The tool owns only the gesture/session lifecycle. Coverage baking remains in
 * the engine, so add/subtract, soft edges, and bounded rasterization behave the
 * same for pointer input and future non-pointer clients.
 */
export class SelectionPaintTool implements Tool {
  id = 'selectionPaint' as const;

  private pointerId = -1;
  private strokeSelection: AreaSelection | null = null;
  private sessionOriginalSelection: AreaSelection | null = null;
  private sessionSelection: AreaSelection | null = null;
  private stamps: MaskBrushStamp[] = [];

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  onActivate(ctx: ToolContext): void {
    this.sessionOriginalSelection = ctx.areaSelection ?? null;
    this.sessionSelection = this.sessionOriginalSelection;
    this.stamps = [];
    if (!this.sessionSelection) ctx.announce('Create a pixel selection before painting it');
  }

  onDeactivate(_ctx: ToolContext): void {
    this.pointerId = -1;
    this.strokeSelection = null;
    this.sessionOriginalSelection = null;
    this.sessionSelection = null;
    this.stamps = [];
  }

  onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const selection = ctx.areaSelection ?? this.sessionSelection;
    if (!selection || !ctx.setAreaSelection || this.pointerId !== -1) {
      if (!selection) ctx.announce('Create a pixel selection before painting it');
      return { consumed: false };
    }
    this.sessionSelection ??= selection;
    this.strokeSelection = selection;
    this.stamps = [];
    this.pointerId = e.pointerId;
    ctx.setPointerCapture(e.pointerId);
    this.addStamp(e, ctx);
    return { consumed: true, captured: true };
  }

  onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (e.pointerId !== this.pointerId) return;
    this.addStamp(e, ctx);
  }

  onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (e.pointerId !== this.pointerId) return;
    this.addStamp(e, ctx);
    this.commitStroke(ctx);
    ctx.releasePointerCapture(e.pointerId);
    this.pointerId = -1;
    this.strokeSelection = null;
    this.stamps = [];
  }

  onPointerCancel(e: PointerEvent, ctx: ToolContext): void {
    if (e.pointerId !== this.pointerId) return;
    ctx.releasePointerCapture(e.pointerId);
    this.pointerId = -1;
    this.strokeSelection = null;
    this.stamps = [];
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    if (this.pointerId !== -1) {
      ctx.releasePointerCapture(this.pointerId);
      this.pointerId = -1;
      this.strokeSelection = null;
      this.stamps = [];
      ctx.announce('Selection paint stroke cancelled');
      return true;
    }
    if (ctx.setAreaSelection) {
      ctx.setAreaSelection(this.sessionOriginalSelection);
      ctx.announce('Selection paint cancelled');
      return true;
    }
    return false;
  }

  /** Selection captured when the paint session began, for an explicit Cancel. */
  getOriginalSelection(): AreaSelection | null {
    return this.sessionOriginalSelection;
  }

  private addStamp(e: PointerEvent, ctx: ToolContext): void {
    const point = ctx.canvasToWorld(e.clientX, e.clientY);
    const radius = 18 / Math.max(ctx.zoom ?? 1, 0.01);
    const previous = this.stamps[this.stamps.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < radius * 0.2) return;
    this.stamps.push({
      x: point.x,
      y: point.y,
      radius,
      hardness: 0.8,
      mode: e.altKey || e.button === 2 ? 'subtract' : 'add',
    });
  }

  private commitStroke(ctx: ToolContext): void {
    if (!this.strokeSelection || this.stamps.length === 0 || !ctx.setAreaSelection) return;
    const next = paintSelectionMask(this.strokeSelection, this.stamps);
    if (!next) {
      ctx.announce('Selection paint exceeded the bounded working area');
      return;
    }
    if (ctx.commitAreaSelection) ctx.commitAreaSelection(next);
    else ctx.setAreaSelection(next);
    this.sessionSelection = next;
    ctx.announce('Selection painted');
  }
}
