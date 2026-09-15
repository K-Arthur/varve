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
  private activePointerType: 'mouse' | 'pen' | 'touch' | 'unknown' = 'mouse';

  abstract cursor(state: ToolCursorState): CursorSpec;

  /** Override to customise initialisation on tool activation. */
  onActivate?(ctx: ToolContext): void;
  /** Override to clean up when tool is deactivated. */
  onDeactivate?(ctx: ToolContext): void;
  /** Override to finish keyboard-owned gestures when focus leaves the canvas. */
  onFocusLoss?(_ctx: ToolContext): void;

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
    this.activePointerType =
      e.pointerType === 'mouse' || e.pointerType === 'pen' || e.pointerType === 'touch'
        ? e.pointerType
        : 'unknown';
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
    this.activePointerType = 'mouse';
  }

  onPointerCancel(e: PointerEvent, ctx: ToolContext): void {
    if (
      this.drag.kind === 'dragging' &&
      this.drag.pointerId !== e.pointerId &&
      (this.activePointerType !== 'touch' || e.pointerType !== 'touch')
    ) {
      return;
    }
    this.onDragCancel?.(ctx);
    ctx.releasePointerCapture(e.pointerId);
    this.drag = this.freshDrag();
    this.activePointerType = 'mouse';
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

  /**
   * Plane-space drag extents with modifiers applied. Returns `null` when no
   * construction plane is active.
   */
  protected computePlaneDrag(ctx: ToolContext): {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
    du: number;
    dv: number;
    centreU: number;
    centreV: number;
  } | null {
    const toPlane = ctx.worldToPlane;
    if (!ctx.activeConstructionPlane || !toPlane) return null;
    const start = toPlane(this.drag.startWorld);
    const current = toPlane(this.drag.currentWorld);
    if (!start || !current) return null;
    let du = current.u - start.u;
    let dv = current.v - start.v;
    if (ctx.shiftKey) {
      const size = Math.max(Math.abs(du), Math.abs(dv));
      du = size * Math.sign(du) || du;
      dv = size * Math.sign(dv) || dv;
    }
    if (ctx.altKey) {
      return {
        u0: start.u - du,
        v0: start.v - dv,
        u1: start.u + du,
        v1: start.v + dv,
        du: Math.abs(du) * 2,
        dv: Math.abs(dv) * 2,
        centreU: start.u,
        centreV: start.v,
      };
    }
    return {
      u0: Math.min(start.u, start.u + du),
      v0: Math.min(start.v, start.v + dv),
      u1: Math.max(start.u, start.u + du),
      v1: Math.max(start.v, start.v + dv),
      du: Math.abs(du),
      dv: Math.abs(dv),
      centreU: start.u + du / 2,
      centreV: start.v + dv / 2,
    };
  }

  /**
   * Plane-aware drag rectangle. Shift equalises *plane* extents (a square in
   * plane coordinates), Alt drags from the centre; the four corners are then
   * mapped back to document space through the plane basis.
   */
  protected computePlaneDragQuad(ctx: ToolContext): {
    corners: Array<{ x: number; y: number }>;
    origin: { x: number; y: number };
    du: number;
    dv: number;
  } | null {
    const drag = this.computePlaneDrag(ctx);
    const toWorld = ctx.planeToWorld;
    if (!drag || !toWorld) return null;
    const mapped = [
      toWorld({ u: drag.u0, v: drag.v0 }),
      toWorld({ u: drag.u1, v: drag.v0 }),
      toWorld({ u: drag.u1, v: drag.v1 }),
      toWorld({ u: drag.u0, v: drag.v1 }),
    ];
    if (mapped.some((corner) => corner === null)) return null;
    const corners = mapped as Array<{ x: number; y: number }>;
    return { corners, origin: corners[0]!, du: drag.du, dv: drag.dv };
  }

  /**
   * Plane-aware circle/ellipse outline, as the exact affine image of a cubic
   * circle approximation: four cubic Bézier segments of a circle in plane
   * coordinates are mapped through the plane basis, so the result is a true
   * projected ellipse (not a screen-space ellipse that merely looks right).
   * The standard control constant keeps the approximation error below
   * ~2.7e-4 of the radius, and an affine map preserves that relative bound.
   */
  protected computePlaneEllipsePoints(ctx: ToolContext): {
    points: Array<{
      x: number;
      y: number;
      handleIn: [number, number] | null;
      handleOut: [number, number] | null;
    }>;
    origin: { x: number; y: number };
    rx: number;
    ry: number;
  } | null {
    const drag = this.computePlaneDrag(ctx);
    const toWorld = ctx.planeToWorld;
    if (!drag || !toWorld) return null;
    const rx = drag.du / 2;
    const ry = drag.dv / 2;
    if (!(rx > 0) || !(ry > 0)) return null;
    const k = 0.5522847498307936;
    // Circle of radius 1 in plane space, centred on the origin, as four
    // cubic segments; scale by rx/ry and translate to the centre.
    const circlePoints: Array<{
      x: number;
      y: number;
      inDir: [number, number];
      outDir: [number, number];
    }> = [
      { x: 1, y: 0, inDir: [0, -k], outDir: [0, k] },
      { x: 0, y: 1, inDir: [k, 0], outDir: [-k, 0] },
      { x: -1, y: 0, inDir: [0, k], outDir: [0, -k] },
      { x: 0, y: -1, inDir: [-k, 0], outDir: [k, 0] },
    ];
    const points = circlePoints.map((point) => {
      const u = drag.centreU + point.x * rx;
      const v = drag.centreV + point.y * ry;
      const world = toWorld({ u, v });
      const handleInWorld = toWorld({
        u: u + point.inDir[0] * rx,
        v: v + point.inDir[1] * ry,
      });
      const handleOutWorld = toWorld({
        u: u + point.outDir[0] * rx,
        v: v + point.outDir[1] * ry,
      });
      if (!world || !handleInWorld || !handleOutWorld) return null;
      return {
        x: world.x,
        y: world.y,
        handleIn: [handleInWorld.x - world.x, handleInWorld.y - world.y] as [number, number],
        handleOut: [handleOutWorld.x - world.x, handleOutWorld.y - world.y] as [number, number],
      };
    });
    if (points.some((point) => point === null)) return null;
    const first = toWorld({ u: drag.centreU, v: drag.centreV });
    if (!first) return null;
    return {
      points: points as Array<{
        x: number;
        y: number;
        handleIn: [number, number] | null;
        handleOut: [number, number] | null;
      }>,
      origin: first,
      rx,
      ry,
    };
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
