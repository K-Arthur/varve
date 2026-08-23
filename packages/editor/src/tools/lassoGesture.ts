/**
 * Shared lasso gesture engine for both object and pixel lasso tools.
 *
 * `LassoTool` (object selection) and `PixelLassoTool` (area selection) share an
 * identical interaction state machine — freehand drag and click-to-place
 * polygonal modes, pointer sampling with distance-based simplification, draft
 * overlay emission, closure detection, and keyboard point editing. This module
 * encapsulates that machine so the two tools are thin adapters that differ only
 * in what they do with the final polygon (select nodes vs. build an
 * AreaSelection). See prompt section 8: one lower-level gesture engine with two
 * adapters, no duplicated tool bodies.
 *
 * Point coordinates are document-space `Point2D` (x/y). The tool supplies world
 * coordinates from its `BaseTool` drag state and the raw pointer event so this
 * engine stays free of camera/coordinate concerns.
 */

import { type Point2D, simplifyPolygon } from './lassoGeometry';
import type { SelectionOperation } from './selectionOperations';
import type { ToolContext } from './types';

const LASSO_MIN_DISTANCE = 2;
const CLOSE_TOLERANCE_PX = 8;
const MIN_POINTS = 3;

export type LassoGestureMode = 'freehand' | 'polygonal';

type LassoGestureState =
  | { kind: 'idle' }
  | { kind: 'freehand-drag'; points: Point2D[] }
  | { kind: 'polygonal-placing'; points: Point2D[]; nextScreen: { x: number; y: number } | null };

export interface LassoGestureCallbacks {
  /** Invoked with the finalized, simplified polygon and the resolved operation. */
  commit: (points: Point2D[], operation: SelectionOperation, ctx: ToolContext) => void;
  /**
   * Optional idle-state Escape handling (e.g. pixel lasso clearing the active
   * area selection). Should return true if it consumed the event.
   */
  onEscapeIdle?: (ctx: ToolContext) => boolean;
  /** Prefix for draft labels, e.g. 'Lasso' or 'Pixel lasso'. */
  labelPrefix: string;
}

export class LassoGesture {
  private state: LassoGestureState = { kind: 'idle' };
  private operation: SelectionOperation = 'replace';
  private mode: LassoGestureMode = 'freehand';

  constructor(private readonly callbacks: LassoGestureCallbacks) {}

  setMode(mode: LassoGestureMode): void {
    this.mode = mode;
  }

  getMode(): LassoGestureMode {
    return this.mode;
  }

  isIdle(): boolean {
    return this.state.kind === 'idle';
  }

  isPlacing(): boolean {
    return this.state.kind === 'polygonal-placing';
  }

  /** Reset to idle and clear any in-flight draft. */
  reset(ctx: ToolContext): void {
    if (this.state.kind !== 'idle') ctx.setDraft(null);
    this.state = { kind: 'idle' };
  }

  /** Set the resolved gesture operation (caller decides modifier vs. option-bar precedence). */
  setOperation(operation: SelectionOperation): void {
    this.operation = operation;
  }

  onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
    world: Point2D,
  ): { consumed: boolean; captured?: boolean } {
    if (this.mode !== 'polygonal') return { consumed: false };
    if (this.state.kind === 'idle') {
      this.state = { kind: 'polygonal-placing', points: [world], nextScreen: null };
      this.emitDraft(ctx);
      return { consumed: true, captured: true };
    }
    if (this.state.kind === 'polygonal-placing') {
      const points = this.state.points;
      if (points.length >= MIN_POINTS && points[0]) {
        const firstScreen = ctx.worldToCanvas(points[0].x, points[0].y);
        const dist = Math.hypot(e.clientX - firstScreen.x, e.clientY - firstScreen.y);
        if (dist <= CLOSE_TOLERANCE_PX) {
          this.finishPolygonal(ctx, points);
          return { consumed: true };
        }
      }
      const newPoints = [...points, world];
      this.state = {
        kind: 'polygonal-placing',
        points: newPoints,
        nextScreen: { x: e.clientX, y: e.clientY },
      };
      this.emitDraft(ctx);
      return { consumed: true, captured: false };
    }
    return { consumed: false };
  }

  onDragStart(ctx: ToolContext, startWorld: Point2D): void {
    if (this.mode === 'polygonal') return;
    this.state = { kind: 'freehand-drag', points: [startWorld] };
    this.emitDraft(ctx);
  }

  onDragMove(
    ctx: ToolContext,
    currentWorld: Point2D,
    lastPointerEvent: { clientX: number; clientY: number } | null,
  ): void {
    if (this.state.kind === 'freehand-drag') {
      const points = this.state.points;
      const last = points[points.length - 1];
      if (last) {
        const dx = currentWorld.x - last.x;
        const dy = currentWorld.y - last.y;
        if (Math.hypot(dx, dy) >= LASSO_MIN_DISTANCE) {
          this.state = { kind: 'freehand-drag', points: [...points, currentWorld] };
          this.emitDraft(ctx);
        }
      }
    } else if (this.state.kind === 'polygonal-placing') {
      if (lastPointerEvent) {
        this.state = {
          ...this.state,
          nextScreen: { x: lastPointerEvent.clientX, y: lastPointerEvent.clientY },
        };
        this.emitDraft(ctx);
      }
    }
  }

  onDragEnd(ctx: ToolContext): void {
    if (this.state.kind !== 'freehand-drag') return;
    ctx.setDraft(null);
    const points = this.state.points;
    this.state = { kind: 'idle' };
    if (points.length < MIN_POINTS) return;
    const simplified = simplifyPolygon(points, LASSO_MIN_DISTANCE);
    if (simplified.length < MIN_POINTS) return;
    this.callbacks.commit(simplified, this.operation, ctx);
  }

  onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.state = { kind: 'idle' };
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    // Escape is handled in every mode: it cancels an in-progress polygonal
    // placement, or defers to the idle callback (e.g. clearing the active area
    // selection for pixel lasso in freehand mode).
    if (e.key === 'Escape') {
      if (this.state.kind === 'polygonal-placing') {
        ctx.setDraft(null);
        this.state = { kind: 'idle' };
        return true;
      }
      return this.callbacks.onEscapeIdle?.(ctx) ?? false;
    }

    if (this.mode !== 'polygonal') return false;

    if (e.key === 'Enter' && !e.repeat) {
      if (this.state.kind === 'polygonal-placing' && this.state.points.length >= MIN_POINTS) {
        this.finishPolygonal(ctx, this.state.points);
        return true;
      }
      return false;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.repeat) {
      if (this.state.kind === 'polygonal-placing' && this.state.points.length >= 1) {
        const newPoints = this.state.points.slice(0, -1);
        if (newPoints.length === 0) {
          this.state = { kind: 'idle' };
          ctx.setDraft(null);
        } else {
          this.state = {
            kind: 'polygonal-placing',
            points: newPoints,
            nextScreen: this.state.nextScreen,
          };
          this.emitDraft(ctx);
        }
        return true;
      }
      return false;
    }

    return false;
  }

  private finishPolygonal(ctx: ToolContext, points: Point2D[]): void {
    ctx.setDraft(null);
    this.state = { kind: 'idle' };
    if (points.length < MIN_POINTS) return;
    this.callbacks.commit(points, this.operation, ctx);
  }

  private emitDraft(ctx: ToolContext): void {
    if (this.state.kind !== 'freehand-drag' && this.state.kind !== 'polygonal-placing') return;
    const pts = this.state.points;
    const label =
      this.state.kind === 'freehand-drag'
        ? this.callbacks.labelPrefix
        : `${this.callbacks.labelPrefix} poly lasso: ${pts.length} pts`;
    ctx.setDraft({ kind: 'freehand', points: pts, label });
  }
}
