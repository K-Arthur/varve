/**
 * PixelLassoTool — freehand and polygonal pixel-area selection.
 *
 * Delegates the shared lasso gesture state machine to `LassoGesture` and
 * supplies the area-selection commit behaviour: it builds an analytical
 * `PolygonSelectionShape` in the AreaSelection expression tree (unlike
 * `LassoTool`, which selects scene nodes by polygon intersection). Supports
 * freehand and polygonal modes, add/subtract/intersect via modifiers, feather,
 * antialias, and cancellation.
 *
 * Shift (add), Alt (subtract), Shift+Alt (intersect) modifiers.
 */

import {
  type AreaSelectionOperation,
  type AreaSelectionSettings,
  combineAreaSelections,
  createAreaSelection,
  DEFAULT_AREA_SELECTION_SETTINGS,
} from '@varve/engine';
import { BaseTool } from './BaseTool';
import type { Point2D } from './lassoGeometry';
import { LassoGesture, type LassoGestureMode } from './lassoGesture';
import { selectionOperationFromModifiers } from './selectionOperations';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class PixelLassoTool extends BaseTool {
  id = 'pixelLasso' as const;

  private readonly gesture: LassoGesture;
  private gestureSettings: AreaSelectionSettings = { ...DEFAULT_AREA_SELECTION_SETTINGS };

  constructor() {
    super();
    this.gesture = new LassoGesture({
      labelPrefix: 'Pixel lasso',
      commit: (points, operation, ctx) => this.applySelection(points, operation, ctx),
      onEscapeIdle: (ctx) => {
        if (ctx.areaSelection && ctx.setAreaSelection) {
          ctx.setAreaSelection(null);
          ctx.announce('Pixel selection cleared');
          return true;
        }
        return false;
      },
    });
  }

  setMode(mode: LassoGestureMode): void {
    this.gesture.setMode(mode);
  }

  getMode(): LassoGestureMode {
    return this.gesture.getMode();
  }

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  override onActivate(ctx: ToolContext): void {
    this.gesture.reset(ctx);
  }

  override onDeactivate(ctx: ToolContext): void {
    this.gesture.reset(ctx);
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    if (this.gesture.isIdle()) {
      this.gestureSettings = {
        ...DEFAULT_AREA_SELECTION_SETTINGS,
        ...(ctx.areaSelectionSettings ?? {}),
      };
      this.operation =
        e.shiftKey || e.altKey
          ? selectionOperationFromModifiers(e)
          : this.gestureSettings.operation;
      this.gesture.setOperation(this.operation);
    }
    if (this.gesture.getMode() !== 'polygonal') return super.onPointerDown(e, ctx);
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    return this.gesture.onPointerDown(e, ctx, world);
  }

  override onDragStart(ctx: ToolContext): void {
    this.gesture.onDragStart(ctx, this.drag.startWorld);
  }

  override onDragMove(ctx: ToolContext): void {
    this.gesture.onDragMove(ctx, this.drag.currentWorld, ctx.lastPointerEvent ?? null);
  }

  override onDragEnd(ctx: ToolContext): void {
    this.gesture.onDragEnd(ctx);
  }

  override onDragCancel(ctx: ToolContext): void {
    this.gesture.onDragCancel(ctx);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    return this.gesture.onKeyDown(e, ctx);
  }

  private operation: AreaSelectionOperation = 'replace';

  private applySelection(
    polygon: Point2D[],
    operation: AreaSelectionOperation,
    ctx: ToolContext,
  ): void {
    const incoming = createAreaSelection(
      {
        kind: 'polygon',
        points: polygon,
        feather: this.gestureSettings.feather,
        antialias: this.gestureSettings.antialias,
      },
      (ctx.areaSelection?.generation ?? 0) + 1,
    );
    if (!incoming || !ctx.setAreaSelection) return;

    const next = combineAreaSelections(
      ctx.areaSelection ?? null,
      incoming,
      operation,
      (ctx.areaSelection?.generation ?? 0) + 1,
    );
    ctx.setAreaSelection(next);

    const bounds = computePolygonBounds(polygon);
    ctx.announce(
      `Pixel lasso selection, ${formatSize(bounds.w)} by ${formatSize(bounds.h)} document pixels`,
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computePolygonBounds(points: Point2D[]): { w: number; h: number } {
  if (points.length === 0) return { w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

function formatSize(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
}
