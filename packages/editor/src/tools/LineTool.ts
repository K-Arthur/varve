/**
 * LineTool — drag start→end, Shift=45° increments.
 *
 * Research basis: Figma Line (L), Illustrator Line Segment (\).
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class LineTool extends BaseTool {
  id = 'line' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const line = this.computeDragLine(ctx);
    const len = Math.sqrt((line.x2 - line.x1) ** 2 + (line.y2 - line.y1) ** 2);
    ctx.setDraft({
      kind: 'line',
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      label: `${Math.round(len)}px`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const line = this.computeDragLine(ctx);
    const w = Math.abs(line.x2 - line.x1) || 4;
    const h = Math.abs(line.y2 - line.y1) || 4;
    const cx = Math.min(line.x1, line.x2) + w / 2;
    const cy = Math.min(line.y1, line.y2) + h / 2;
    const parentId = this.commitToParent({ x: cx, y: cy }, ctx);

    if (this.isBelowThreshold(ctx)) {
      ctx.createShapeAt(this.drag.startWorld, undefined, parentId);
    } else {
      // Line is at its own position via shape coordinates, not transform
      ctx.createShapeAt(
        { x: Math.min(line.x1, line.x2) + w / 2, y: Math.min(line.y1, line.y2) + h / 2 },
        { w, h },
        parentId,
      );
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }
}
