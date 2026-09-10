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

import type { PathPoint } from '@varve/engine';
import { OneEuroFilter, oneEuroFilterPoint, strokePoint } from '@varve/scene';
import {
  cancelEditorFrame,
  createEditorFrameKey,
  requestEditorFrame,
} from '../performance/editorFrameRuntime';
import { BaseTool } from './BaseTool';
import type { Point2D } from './fitting';
import { fitPathToBeziers, simplifyPoints } from './fitting';
import { collectSourceEvents, normalizeInputEvent } from './inputNormalizer';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface CapturedPoint extends Point2D {
  pressure: number;
}

export class PencilTool extends BaseTool {
  id = 'pencil' as const;

  private captured: CapturedPoint[] = [];
  private readonly frameKey = createEditorFrameKey('pencil');
  /** Per-point pressure tracking. Updated from each pointer event. */
  private currentPressure: number = 0.5;

  private oneEuro: OneEuroFilter = new OneEuroFilter(1.0, 0.007, 1.0);

  /** Stabilization strength: 0 = disabled (identity pass-through), 1 = full strength.
   *  Default 0.3 (light stabilization). Maps to OneEuro minCutoff = 1 + strength * 10. */
  private stabilizationStrength: number = 0.3;

  /** Self-advancing time counter for the OneEuro filter (avoids dt=0 in fake-timer tests). */
  private filterTime = 0;

  setStabilization(strength: number): void {
    this.stabilizationStrength = Math.max(0, Math.min(1, strength));
    const minCutoff = 1 + (1 - this.stabilizationStrength) * 10;
    this.oneEuro.updateConfig({ minCutoff });
  }

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.currentPressure = e.pressure > 0 ? e.pressure : 0.5;
    this.oneEuro.reset();
    this.filterTime = normalizeInputEvent(e).time;
    const sp = strokePoint(world.x, world.y, {
      pressure: this.currentPressure,
      time: this.filterTime,
    });
    const filtered = oneEuroFilterPoint(sp, this.oneEuro);
    this.captured = [{ x: filtered.x, y: filtered.y, pressure: this.currentPressure }];
    this.startCapture(ctx);
    return result;
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
    this.currentPressure = e.pressure > 0 ? e.pressure : 0.5;

    // Sample coalesced sub-frame events when available (Chrome/Firefox/Safari 18.2+).
    // WebKitGTK returns a stub — falls back to the single event.
    const events = ctx.sourceEvents.length > 0 ? ctx.sourceEvents : collectSourceEvents(e, true);
    for (const ev of events) {
      if (ev.isPredicted) continue;
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      this.samplePoint(world, ev.pressure > 0 ? ev.pressure : 0.5, ev.time, ctx);
    }
  }

  /** Append a captured point if it moved enough from the last sample. */
  private samplePoint(
    world: { x: number; y: number },
    pressure: number,
    time: number,
    ctx: ToolContext,
  ): void {
    if (this.captured.length === 0) return;
    this.filterTime = Math.max(this.filterTime, time);
    const rawSp = strokePoint(world.x, world.y, { pressure, time: this.filterTime });
    const filtered = oneEuroFilterPoint(rawSp, this.oneEuro);

    const last = this.captured[this.captured.length - 1] as Point2D;
    const dx = filtered.x - last.x;
    const dy = filtered.y - last.y;
    if (dx * dx + dy * dy > 1) {
      this.captured.push({ x: filtered.x, y: filtered.y, pressure });
      ctx.setDraft({
        kind: 'freehand',
        points: this.captured,
        label: `${this.captured.length} pts`,
      });
    }
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
    this.currentPressure = e.pressure > 0 ? e.pressure : 0.5;
    this.samplePoint(
      this.drag.currentWorld,
      this.currentPressure,
      normalizeInputEvent(e).time,
      ctx,
    );
    this.stopCapture();

    ctx.beginTransaction();
    try {
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
      // Per-point pressure from captured data
      const pathPoints: PathPoint[] = fitted.map((p) => ({
        x: p.x,
        y: p.y,
        handleIn: p.handleIn as [number, number] | null,
        handleOut: p.handleOut as [number, number] | null,
        pressure: p.pressure ?? 0.5,
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
        false,
      );
    } finally {
      ctx.commitTransaction();
    }
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
    const capture = (frameTimeMs: number) => {
      if (this.drag.kind !== 'dragging') return;
      if (this.captured.length > 0) {
        this.samplePoint(this.drag.currentWorld, this.currentPressure, frameTimeMs, ctx);
      }
      requestEditorFrame(this.frameKey, 'input', capture);
    };
    requestEditorFrame(this.frameKey, 'input', capture);
  }

  private stopCapture(): void {
    cancelEditorFrame(this.frameKey);
  }

  private reset(): void {
    this.captured = [];
    this.oneEuro.reset();
    this.filterTime = 0;
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
