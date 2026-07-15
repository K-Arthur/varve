/**
 * ArrowTool — drag start→end, Shift=45° increments.
 *
 * Research basis: Figma arrow tool, Illustrator arrow segment.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class ArrowTool extends BaseTool {
  id = 'arrow' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const line = this.computeDragLine(ctx);
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.round(Math.atan2(dy, dx) * (180 / Math.PI));
    ctx.setDraft({
      kind: 'arrow',
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      label: `${Math.round(len)}px · ${angle}°`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const line = this.computeDragLine(ctx);
    const parentId = this.commitToParent({ x: line.x1, y: line.y1 }, ctx);

    if (this.isBelowThreshold(ctx)) {
      ctx.createShapeAt(this.drag.startWorld, undefined, parentId);
    } else {
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      ctx.createShapeAt({ x: line.x1, y: line.y1 }, { w: dx || 4, h: dy || 4 }, parentId);
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }
}
