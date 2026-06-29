/**
 * FrameTool — drag to create a frame container, not a leaf shape.
 *
 * Creates FrameNode with children[]. Below-threshold click → default frame size.
 * Shift=square, Alt=from-center.
 *
 * Research basis: Figma Frame (F), Illustrator Artboard.
 */
import type { ToolContext, ToolCursorState, CursorSpec } from './types';
import { BaseTool } from './BaseTool';

const DEFAULT_FRAME_W = 375;
const DEFAULT_FRAME_H = 812;

export class FrameTool extends BaseTool {
  id = 'frame' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, label: `${Math.round(rect.w)} x ${Math.round(rect.h)}` });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const rect = this.computeDragRect(ctx);

    if (this.isBelowThreshold(ctx)) {
      ctx.createShapeAt(
        {
          x: this.drag.startWorld.x - DEFAULT_FRAME_W / 2,
          y: this.drag.startWorld.y - DEFAULT_FRAME_H / 2,
        },
        { w: DEFAULT_FRAME_W, h: DEFAULT_FRAME_H },
        null,
      );
    } else if (rect.w > 0 && rect.h > 0) {
      ctx.createShapeAt({ x: rect.x, y: rect.y }, { w: rect.w, h: rect.h }, null);
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }
}
