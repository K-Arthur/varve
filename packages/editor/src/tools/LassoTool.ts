/**
 * LassoTool — freehand and polygonal object (node) selection.
 *
 * Delegates the shared lasso gesture state machine to `LassoGesture` and only
 * supplies the node-selection commit behaviour: it finds scene nodes whose
 * transformed geometry intersects the lasso polygon and applies the resolved
 * boolean operation to the node selection. For the pixel-area variant see
 * `PixelLassoTool`.
 *
 * Research basis: Figma, Photoshop, GIMP lasso selection tools.
 */

import { buildParentIndexMap, isInIsolatedSubtree, walkNodes } from '@varve/scene';
import { nodeWorldBounds } from '../scene/world';
import { BaseTool } from './BaseTool';
import { type Point2D, polygonIntersectsBounds } from './lassoGeometry';
import { LassoGesture, type LassoGestureMode } from './lassoGesture';
import { isMarqueeSelectableNode } from './marqueeGeometry';
import {
  commitNodeSelectionOperation,
  type SelectionOperation,
  selectionOperationFromModifiers,
} from './selectionOperations';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class LassoTool extends BaseTool {
  id = 'lasso' as const;

  private readonly gesture: LassoGesture;

  constructor() {
    super();
    this.gesture = new LassoGesture({
      labelPrefix: 'Lasso',
      commit: (points, operation, ctx) => this.applySelection(points, operation, ctx),
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
      this.gesture.setOperation(selectionOperationFromModifiers(e));
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

  private applySelection(
    polygon: Point2D[],
    operation: SelectionOperation,
    ctx: ToolContext,
  ): void {
    const intersectingIds = this.findIntersectingNodes(ctx, polygon);
    const next = commitNodeSelectionOperation(ctx, intersectingIds, operation);
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
    const page = doc.pages?.find((candidate) => candidate.id === activePageId);
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
