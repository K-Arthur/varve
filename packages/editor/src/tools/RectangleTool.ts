/**
 * RectangleTool — drag to size, Shift=square, Alt=from-center.
 *
 * When an isometric construction plane is active the drag is solved in plane
 * coordinates and the result is a projected quad (an editable closed path);
 * without a plane the ordinary axis-aligned rect is created unchanged.
 *
 * Research basis: ubiquitous design tool pattern (Figma R, Illustrator M).
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class RectangleTool extends BaseTool {
  id = 'rect' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const quad = this.computePlaneDragQuad(ctx);
    if (quad) {
      ctx.setDraft({
        kind: 'freehand',
        points: [...quad.corners, quad.corners[0]!],
        label: `${Math.round(quad.du)} × ${Math.round(quad.dv)}`,
      });
      return;
    }
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      label: `${Math.round(rect.w)} x ${Math.round(rect.h)}`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const quad = this.computePlaneDragQuad(ctx);
    if (quad) {
      if (quad.du <= 0 || quad.dv <= 0) return;
      const centre = {
        x: (quad.corners[0]!.x + quad.corners[2]!.x) / 2,
        y: (quad.corners[0]!.y + quad.corners[2]!.y) / 2,
      };
      const parentId = this.commitToParent(centre, ctx);
      ctx.createShapeAt(
        quad.origin,
        undefined,
        parentId,
        quad.corners.map((corner) => ({
          x: corner.x,
          y: corner.y,
          handleIn: null,
          handleOut: null,
        })),
        true,
      );
      return;
    }
    const rect = this.computeDragRect(ctx);
    const parentId = this.commitToParent({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, ctx);
    if (this.isBelowThreshold(ctx)) {
      ctx.createShapeAt(this.drag.startWorld, undefined, parentId);
    } else if (rect.w > 0 && rect.h > 0) {
      ctx.createShapeAt({ x: rect.x, y: rect.y }, { w: rect.w, h: rect.h }, parentId);
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }
}
