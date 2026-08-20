/**
 * LassoTool — freehand and polygonal polygon selection.
 *
 * Supports two interaction modes:
 * - `freehand`: drag to draw a freeform polygon (existing behaviour).
 * - `polygonal`: click to place vertices, closure via first-point click,
 *   Enter/Enter to finish, Backspace/Delete to remove, Escape to cancel.
 *
 * Shift (add), Alt (subtract), Shift+Alt (intersect) modifiers.
 *
 * Research basis: Figma, Photoshop, GIMP lasso selection tools.
 */

import { buildParentIndexMap, isInIsolatedSubtree, walkNodes } from '@varve/scene';
import { nodeWorldBounds } from '../scene/world';
import { BaseTool } from './BaseTool';
import { type Point2D, polygonIntersectsBounds, simplifyPolygon } from './lassoGeometry';
import { isMarqueeSelectableNode } from './marqueeGeometry';
import {
  commitNodeSelectionOperation,
  type SelectionOperation,
  selectionOperationFromModifiers,
} from './selectionOperations';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

const LASSO_MIN_DISTANCE = 2;
const CLOSE_TOLERANCE_PX = 8;
const MIN_POINTS = 3;

// ── Types ────────────────────────────────────────────────────────────────────

export type LassoToolMode = 'freehand' | 'polygonal';
export type { SelectionOperation as SelectionOp } from './selectionOperations';

type LassoState =
  | { kind: 'idle' }
  | { kind: 'freehand-drag'; points: Point2D[] }
  | { kind: 'polygonal-placing'; points: Point2D[]; nextScreen: { x: number; y: number } | null };

// ── Tool ─────────────────────────────────────────────────────────────────────

export class LassoTool extends BaseTool {
  id = 'lasso' as const;

  private mode: LassoToolMode = 'freehand';
  private state: LassoState = { kind: 'idle' };
  private operation: SelectionOperation = 'replace';

  setMode(mode: LassoToolMode): void {
    this.mode = mode;
  }

  getMode(): LassoToolMode {
    return this.mode;
  }

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  override onActivate(_ctx: ToolContext): void {
    this.state = { kind: 'idle' };
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.state.kind !== 'idle') {
      ctx.setDraft(null);
    }
    this.state = { kind: 'idle' };
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  override onDragStart(ctx: ToolContext): void {
    if (this.mode === 'polygonal') {
      // Polygonal mode uses onPointerDown for point placement, not drag
      return;
    }
    this.state = {
      kind: 'freehand-drag',
      points: [this.drag.startWorld],
    };
    this.emitDraft(ctx);
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.state.kind === 'freehand-drag') {
      const current = this.drag.currentWorld;
      const points = this.state.points;
      const last = points[points.length - 1];
      if (last) {
        const dx = current.x - last.x;
        const dy = current.y - last.y;
        if (Math.hypot(dx, dy) >= LASSO_MIN_DISTANCE) {
          this.state = { kind: 'freehand-drag', points: [...points, current] };
          this.emitDraft(ctx);
        }
      }
    } else if (this.state.kind === 'polygonal-placing') {
      if (ctx.lastPointerEvent) {
        this.state = {
          ...this.state,
          nextScreen: { x: ctx.lastPointerEvent.clientX, y: ctx.lastPointerEvent.clientY },
        };
        this.emitDraft(ctx);
      }
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    if (this.state.kind === 'freehand-drag') {
      ctx.setDraft(null);
      const points = this.state.points;
      this.state = { kind: 'idle' };

      if (points.length < MIN_POINTS) return;

      const simplified = simplifyPolygon(points, LASSO_MIN_DISTANCE);
      if (simplified.length < MIN_POINTS) return;

      this.applySelection(simplified, ctx);
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.state = { kind: 'idle' };
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    if (this.state.kind === 'idle') {
      this.operation = selectionOperationFromModifiers(e);
    }
    if (this.mode !== 'polygonal') return super.onPointerDown(e, ctx);

    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);

    if (this.state.kind === 'idle') {
      this.state = {
        kind: 'polygonal-placing',
        points: [world],
        nextScreen: null,
      };
      this.emitDraft(ctx);
      return { consumed: true, captured: true };
    }

    if (this.state.kind === 'polygonal-placing') {
      const points = this.state.points;

      // Check closure (clicking near first point or on it)
      if (points.length >= MIN_POINTS && points[0]) {
        const firstScreen = ctx.worldToCanvas(points[0].x, points[0].y);
        const dist = Math.hypot(canvas.x - firstScreen.x, canvas.y - firstScreen.y);
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

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (this.mode !== 'polygonal') return false;

    if (e.key === 'Escape') {
      ctx.setDraft(null);
      this.state = { kind: 'idle' };
      return true;
    }

    if (e.key === 'Enter' && !e.repeat) {
      if (this.state.kind === 'polygonal-placing' && this.state.points.length >= MIN_POINTS) {
        this.finishPolygonal(ctx, this.state.points);
        return true;
      }
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.repeat) {
      if (this.state.kind === 'polygonal-placing' && this.state.points.length > 1) {
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
    }

    return false;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private finishPolygonal(ctx: ToolContext, points: Point2D[]): void {
    ctx.setDraft(null);
    this.state = { kind: 'idle' };

    if (points.length < MIN_POINTS) return;
    this.applySelection(points, ctx);
  }

  private emitDraft(ctx: ToolContext): void {
    if (this.state.kind !== 'freehand-drag' && this.state.kind !== 'polygonal-placing') return;

    const pts = this.state.points;
    const label = this.state.kind === 'freehand-drag' ? 'Lasso' : `Poly lasso: ${pts.length} pts`;

    ctx.setDraft({
      kind: 'freehand',
      points: pts,
      label,
    });
  }

  private applySelection(polygon: Point2D[], ctx: ToolContext): void {
    const intersectingIds = this.findIntersectingNodes(ctx, polygon);
    const op = this.operation;
    const next = commitNodeSelectionOperation(ctx, intersectingIds, op);

    ctx.announceSelection(
      next
        .map((id) => ctx.getNode(id))
        .filter((n): n is import('@varve/scene').SceneNode => n !== undefined),
    );
  }

  private findIntersectingNodes(ctx: ToolContext, polygon: Point2D[]): string[] {
    const doc = ctx.document;
    const activePageId = doc.activePageId;
    if (!activePageId) return [];
    const page = doc.pages?.find((p) => p.id === activePageId);
    if (!page?.contentRoot) return [];

    const intersecting: string[] = [];
    const contentRoot = page.contentRoot;
    const entries = walkNodes(doc, [contentRoot]);
    const parentIndex = buildParentIndexMap(doc);

    for (const [nodeId] of entries) {
      if (!isMarqueeSelectableNode(doc, nodeId, parentIndex)) continue;
      if (ctx.isolatedNodeId && !isInIsolatedSubtree(nodeId, ctx.isolatedNodeId, doc)) continue;

      const bounds = nodeWorldBounds(doc, nodeId, parentIndex);
      if (!bounds) continue;

      if (polygonIntersectsBounds(polygon, bounds)) {
        intersecting.push(nodeId);
      }
    }

    return intersecting;
  }
}
