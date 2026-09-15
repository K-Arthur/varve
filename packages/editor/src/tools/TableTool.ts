/**
 * TableTool — drag to size a native responsive table, click for the default.
 *
 * ADR-0016: a table is a first-class document capability. Drag inserts a
 * 4×4 table sized to the rect (columns default to fraction fill); a click
 * (below drag threshold) inserts the default table.
 *
 * Research basis: FrameTool/RectangleTool drag-create pattern.
 */
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class TableTool extends BaseTool {
  id = 'table' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      label: 'Table',
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
