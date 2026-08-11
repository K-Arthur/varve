/**
 * BaseTool — abstract foundation for all drawing/gesture tools.
 *
 * Provides a reusable gesture state machine (idle → dragging).
 * pointer capture lifecycle, drag threshold, constrain/from-centre modifiers,
 * and helpers for draft rendering and snap-to-parent.
 *
 * Research basis: Figma/Illustrator drag-to-create patterns, MDN Pointer Events,
 *                 W3C pointer capture specification.
 *
 * Each tool overrides onDragStart / onDragMove / onDragEnd / onDragCancel.
 */

import type {
  CursorSpec,
  GestureResult,
  Tool,
  ToolContext,
  ToolCursorState,
  ToolId,
} from './types';

export interface DragState {
  kind: 'idle' | 'dragging';
  pointerId: number;
  startCanvas: { x: number; y: number };
  startWorld: { x: number; y: number };
  currentCanvas: { x: number; y: number };
  currentWorld: { x: number; y: number };
}

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * Screen-space by construction: it is compared against `startCanvas` /
 * `currentCanvas`, which are `clientX/Y` (CSS pixels). It must NOT be scaled
 * by zoom. The threshold models the user's hand — a hand tremor is the same
 * physical distance whatever the camera is doing — so a zoom-scaled value
 * makes the same gesture behave differently at different zoom levels: at 6%
 * zoom `3 / 0.06` demanded 50 CSS px of travel before anything moved (the
 * canvas felt stuck), and at 1600% `3 / 16` fired on 0.19 px of jitter.
 */
const DRAG_THRESHOLD_CSS_PX = 3;

export abstract class BaseTool implements Tool {
  abstract id: ToolId;

  protected drag: DragState = {
    kind: 'idle',
    pointerId: -1,
    startCanvas: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
    currentCanvas: { x: 0, y: 0 },
    currentWorld: { x: 0, y: 0 },
  };

  private dragStartFired = false;

  abstract cursor(state: ToolCursorState): CursorSpec;

  /** Override to customise initialisation on tool activation. */
  onActivate?(ctx: ToolContext): void;
  /** Override to clean up when tool is deactivated. */
  onDeactivate?(ctx: ToolContext): void;

  /** Called on first pointermove past the drag threshold. */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  onDragStart?(_ctx: ToolContext): void;
  /** Called on every pointermove while dragging. */
  onDragMove?(_ctx: ToolContext): void;
  /** Called on pointerup at end of drag. */
  onDragEnd?(_ctx: ToolContext): void;
  /** Called on pointercancel or Escape. */
  onDragCancel?(_ctx: ToolContext): void;
  /* eslint-enable @typescript-eslint/no-unused-vars */

  onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (this.drag.kind !== 'idle') return { consumed: false };
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
    return { consumed: true, captured: true };
  }

  onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag.currentCanvas = canvas;
    this.drag.currentWorld = world;

    const dx = Math.abs(canvas.x - this.drag.startCanvas.x);
    const dy = Math.abs(canvas.y - this.drag.startCanvas.y);
    if (dx > DRAG_THRESHOLD_CSS_PX || dy > DRAG_THRESHOLD_CSS_PX) {
      if (!this.dragStartFired) {
        this.dragStartFired = true;
        this.onDragStart?.(ctx);
      }
      this.onDragMove?.(ctx);
    }
  }

  onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.dragStartFired = false;
    ctx.releasePointerCapture(e.pointerId);
    this.onDragEnd?.(ctx);
    this.drag = this.freshDrag();
  }

  onPointerCancel(e: PointerEvent, ctx: ToolContext): void {
    this.onDragCancel?.(ctx);
    ctx.releasePointerCapture(e.pointerId);
    this.drag = this.freshDrag();
  }

  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean;
  onKeyUp?(e: KeyboardEvent, ctx: ToolContext): void;
  onDoubleClick?(e: PointerEvent, ctx: ToolContext): void;

  protected checkDragThreshold(_ctx: ToolContext): boolean {
    const dx = Math.abs(this.drag.currentCanvas.x - this.drag.startCanvas.x);
    const dy = Math.abs(this.drag.currentCanvas.y - this.drag.startCanvas.y);
    return dx > DRAG_THRESHOLD_CSS_PX || dy > DRAG_THRESHOLD_CSS_PX;
  }

  /**
   * Total drag displacement in world space. Unlike converting the raw screen
   * delta, this includes camera movement that occurs while a captured pointer
   * remains stationary during edge auto-pan.
   */
  protected worldDragDelta(ctx: ToolContext): { dx: number; dy: number } {
    const start = this.drag.startWorld;
    const current = this.drag.currentWorld;
    if (
      Number.isFinite(start?.x) &&
      Number.isFinite(start?.y) &&
      Number.isFinite(current?.x) &&
      Number.isFinite(current?.y)
    ) {
      return { dx: current.x - start.x, dy: current.y - start.y };
    }
    // Compatibility for partial Tool test fixtures that predate world-space
    // drag state; real pointer gestures always take the branch above.
    return ctx.canvasDeltaToWorld(
      this.drag.currentCanvas.x - this.drag.startCanvas.x,
      this.drag.currentCanvas.y - this.drag.startCanvas.y,
    );
  }

  protected constrainSize(w: number, h: number, shift: boolean): { w: number; h: number } {
    if (!shift) return { w, h };
    const size = Math.max(Math.abs(w), Math.abs(h));
    return { w: size * Math.sign(w) || w, h: size * Math.sign(h) || h };
  }

  protected computeDragRect(ctx: ToolContext): { x: number; y: number; w: number; h: number } {
    const start = this.drag.startWorld;
    const current = this.drag.currentWorld;
    let w = current.x - start.x;
    let h = current.y - start.y;

    if (ctx.shiftKey) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = size * Math.sign(w) || w;
      h = size * Math.sign(h) || h;
    }

    let x: number, y: number;
    if (ctx.altKey) {
      x = start.x - w;
      y = start.y - h;
      w *= 2;
      h *= 2;
    } else {
      x = w < 0 ? start.x + w : start.x;
      y = h < 0 ? start.y + h : start.y;
      w = Math.abs(w);
      h = Math.abs(h);
    }

    return { x, y, w, h };
  }

  protected computeDragLine(ctx: ToolContext): { x1: number; y1: number; x2: number; y2: number } {
    const start = this.drag.startWorld;
    const current = this.drag.currentWorld;
    let x2 = current.x;
    let y2 = current.y;

    if (ctx.shiftKey) {
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const angle = Math.atan2(dy, dx);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.sqrt(dx * dx + dy * dy);
      x2 = start.x + len * Math.cos(snapped);
      y2 = start.y + len * Math.sin(snapped);
    }

    if (ctx.altKey) {
      // Alt-drag: draw from center — start point is the midpoint,
      // line extends equally in both directions.
      const dx = x2 - start.x;
      const dy = y2 - start.y;
      return {
        x1: start.x - dx,
        y1: start.y - dy,
        x2: start.x + dx,
        y2: start.y + dy,
      };
    }

    return { x1: start.x, y1: start.y, x2, y2 };
  }

  protected findContainingFrame(world: { x: number; y: number }, ctx: ToolContext): string | null {
    return ctx.findContainingFrame(world);
  }

  protected commitToParent(world: { x: number; y: number }, _ctx: ToolContext): string | null {
    return this.findContainingFrame(world, _ctx);
  }

  protected isBelowThreshold(_ctx: ToolContext): boolean {
    const dx = Math.abs(this.drag.currentCanvas.x - this.drag.startCanvas.x);
    const dy = Math.abs(this.drag.currentCanvas.y - this.drag.startCanvas.y);
    return dx <= DRAG_THRESHOLD_CSS_PX && dy <= DRAG_THRESHOLD_CSS_PX;
  }

  private freshDrag(): DragState {
    return {
      kind: 'idle',
      pointerId: -1,
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 0, y: 0 },
      currentWorld: { x: 0, y: 0 },
    };
  }
}
