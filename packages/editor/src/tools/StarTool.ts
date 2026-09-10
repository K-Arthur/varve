/**
 * StarTool — drag to size, Shift=constrain, Alt=from-center.
 *
 * Research basis: Figma Star tool, Illustrator Star shape.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class StarTool extends BaseTool {
  id = 'star' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'star',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      points: 5,
      label: `${Math.round(rect.w)} x ${Math.round(rect.h)}`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
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
