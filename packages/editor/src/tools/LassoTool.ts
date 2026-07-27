/**
 * LassoTool — freehand polygon selection.
 *
 * Allows users to draw a freehand path around objects to select them.
 * Nodes whose transformed geometry intersects the lasso polygon are selected.
 * Supports Shift (add) and Alt (subtract) modifiers.
 *
 * Research basis: Figma lasso selection, ray casting for polygon intersection,
 *                 freehand point capture from PencilTool.
 */

import { isInIsolatedSubtree, walkNodes } from '@strata/scene';
import { BaseTool } from './BaseTool';
import { type Point2D, polygonIntersectsBounds, simplifyPolygon } from './lassoGeometry';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

const LASSO_MIN_DISTANCE = 2; // Minimum distance between captured points (world units)

export class LassoTool extends BaseTool {
  id = 'lasso' as const;

  private points: Point2D[] = [];

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  override onDragStart(ctx: ToolContext): void {
    this.points = [this.drag.startWorld];
    ctx.setDraft({
      kind: 'freehand',
      points: this.points,
      label: 'Lasso',
    });
  }

  override onDragMove(ctx: ToolContext): void {
    const current = this.drag.currentWorld;
    const last = this.points[this.points.length - 1];
    if (last) {
      const dx = current.x - last.x;
      const dy = current.y - last.y;
      if (Math.hypot(dx, dy) >= LASSO_MIN_DISTANCE) {
        this.points.push(current);
        ctx.setDraft({
          kind: 'freehand',
          points: this.points,
          label: `${this.points.length} pts`,
        });
      }
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    if (this.points.length < 3) {
      // Not enough points to form a valid polygon
      this.points = [];
      return;
    }

    // Simplify the polygon to reduce point count
    const simplified = simplifyPolygon(this.points, LASSO_MIN_DISTANCE);
    if (simplified.length < 3) {
      this.points = [];
      return;
    }

    // Find intersecting nodes
    const intersectingIds = this.findIntersectingNodes(ctx, simplified);
    if (intersectingIds.length === 0) {
      this.points = [];
      return;
    }

    // Apply selection based on modifiers
    if (ctx.altKey && ctx.shiftKey) {
      // Shift+Alt: intersect (select only nodes that are both in current selection and lasso)
      const currentSet = new Set(ctx.selection);
      const result = intersectingIds.filter((id) => currentSet.has(id));
      if (result.length > 0) {
        ctx.setSelection(result[0] ?? null);
        result.slice(1).forEach((id) => {
          ctx.toggleSelection(id, true);
        });
      } else {
        ctx.setSelection(null);
      }
    } else if (ctx.altKey) {
      // Alt: subtract (remove lassoed nodes from selection)
      const currentSet = new Set(ctx.selection);
      intersectingIds.forEach((id) => {
        if (currentSet.has(id)) {
          ctx.toggleSelection(id, false);
        }
      });
    } else if (ctx.shiftKey) {
      // Shift: add (add lassoed nodes to selection)
      if (ctx.selection.length === 0) {
        ctx.setSelection(intersectingIds[0] ?? null);
        intersectingIds.slice(1).forEach((id) => {
          ctx.toggleSelection(id, true);
        });
      } else {
        intersectingIds.forEach((id) => {
          ctx.toggleSelection(id, true);
        });
      }
    } else {
      // Default: replace selection
      ctx.setSelection(intersectingIds[0] ?? null);
      intersectingIds.slice(1).forEach((id) => {
        ctx.toggleSelection(id, true);
      });
    }

    this.points = [];
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.points = [];
  }

  private findIntersectingNodes(ctx: ToolContext, polygon: Point2D[]): string[] {
    const doc = ctx.document;
    const page = doc.pages?.[doc.activePageId];
    if (!page || !page.contentRoot) return [];

    const intersecting: string[] = [];
    const contentRoot = page.contentRoot;

    // Use walkNodes to get all nodes in the document
    const entries = walkNodes(doc, [contentRoot]);
    for (const [nodeId, entry] of entries) {
      const node = entry.node;

      // Skip locked and invisible nodes
      if (node.locked || node.visible === false) continue;

      // Respect isolation mode
      if (ctx.isolatedNodeId && !isInIsolatedSubtree(nodeId, ctx.isolatedNodeId, doc)) {
        continue;
      }

      // Get node bounds using the context's efficient method
      const bounds = ctx.nodeWorldBounds(node);
      if (!bounds) continue;

      if (polygonIntersectsBounds(polygon, bounds)) {
        intersecting.push(nodeId);
      }
    }

    return intersecting;
  }
}
