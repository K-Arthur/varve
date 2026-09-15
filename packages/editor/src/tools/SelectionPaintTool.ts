import { type AreaSelection, type MaskBrushStamp, paintSelectionMask } from '@varve/engine';
import { interpolateStrokeSegment } from './brushStroke';
import type { CursorSpec, GestureResult, Tool, ToolContext, ToolCursorState } from './types';

/** Quick-mask brush radius in CSS pixels; converted to world units per event. */
const QUICK_MASK_RADIUS_CSS = 18;

/**
 * Quick-mask editor for the analytical area selection.
 *
 * The tool owns only the gesture/session lifecycle. Coverage baking remains in
 * the engine, so add/subtract, soft edges, and bounded rasterization behave the
 * same for pointer input and future non-pointer clients. Coalesced events and
 * segment interpolation keep fast strokes gap-free.
 */
export class SelectionPaintTool implements Tool {
  id = 'selectionPaint' as const;

  private pointerId = -1;
  private strokeSelection: AreaSelection | null = null;
  private sessionOriginalSelection: AreaSelection | null = null;
  private sessionSelection: AreaSelection | null = null;
  private stamps: MaskBrushStamp[] = [];
  private lastStamp: { x: number; y: number } | null = null;

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  onActivate(ctx: ToolContext): void {
    this.sessionOriginalSelection = ctx.areaSelection ?? null;
    this.sessionSelection = this.sessionOriginalSelection;
    this.stamps = [];
    this.lastStamp = null;
    if (!this.sessionSelection) ctx.announce('Create a pixel selection before painting it');
  }

  onDeactivate(_ctx: ToolContext): void {
    this.pointerId = -1;
    this.strokeSelection = null;
    this.sessionOriginalSelection = null;
    this.sessionSelection = null;
    this.stamps = [];
    this.lastStamp = null;
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
    this.lastStamp = null;
    this.pointerId = e.pointerId;
    ctx.setPointerCapture(e.pointerId);
    this.addStrokeSamples(e, ctx);
    return { consumed: true, captured: true };
  }

  onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (e.pointerId !== this.pointerId) return;
    this.addStrokeSamples(e, ctx);
  }

  onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (e.pointerId !== this.pointerId) return;
    this.addStrokeSamples(e, ctx);
    this.commitStroke(ctx);
    ctx.releasePointerCapture(e.pointerId);
    this.pointerId = -1;
    this.strokeSelection = null;
    this.stamps = [];
    this.lastStamp = null;
  }

  onPointerCancel(e: PointerEvent, ctx: ToolContext): void {
    if (e.pointerId !== this.pointerId) return;
    ctx.releasePointerCapture(e.pointerId);
    this.pointerId = -1;
    this.strokeSelection = null;
    this.stamps = [];
    this.lastStamp = null;
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    if (this.pointerId !== -1) {
      ctx.releasePointerCapture(this.pointerId);
      this.pointerId = -1;
      this.strokeSelection = null;
      this.stamps = [];
      this.lastStamp = null;
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

  private addStrokeSamples(e: PointerEvent, ctx: ToolContext): void {
    const radius = QUICK_MASK_RADIUS_CSS / Math.max(ctx.zoom ?? 1, 0.01);
    const subtract = e.altKey || e.button === 2;
    const samples: Array<{ x: number; y: number }> = [];
    if (typeof e.getCoalescedEvents === 'function') {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 0) {
        for (const ce of coalesced) {
          samples.push(ctx.canvasToWorld(ce.clientX, ce.clientY));
        }
      }
    }
    if (samples.length === 0) samples.push(ctx.canvasToWorld(e.clientX, e.clientY));
    else {
      const current = ctx.canvasToWorld(e.clientX, e.clientY);
      const last = samples[samples.length - 1]!;
      if (Math.hypot(current.x - last.x, current.y - last.y) > 1e-6) samples.push(current);
    }

    const spacing = Math.max(1, radius * 0.5);
    for (const point of samples) {
      if (!this.lastStamp) {
        this.stamps.push({
          x: point.x,
          y: point.y,
          radius,
          hardness: 0.8,
          mode: subtract ? 'subtract' : 'add',
        });
        this.lastStamp = point;
        continue;
      }
      for (const interpolated of interpolateStrokeSegment(this.lastStamp, point, spacing)) {
        this.stamps.push({
          x: interpolated.x,
          y: interpolated.y,
          radius,
          hardness: 0.8,
          mode: subtract ? 'subtract' : 'add',
        });
      }
      this.lastStamp = point;
    }
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
