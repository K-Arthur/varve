/**
 * TextTool — click for point text (auto-width), drag for text box (fixed-width).
 *
 * Click → enter edit mode immediately. Drag → create text box at size.
 * Escape exits edit → selects text object.
 * Double-click existing text → edit.
 *
 * Research basis: Figma Text (T), Illustrator Type (T).
 *
 * Note: Inline text editing requires contentEditable overlay integration.
 *       This implementation creates TextNodes and enters edit mode.
 *       Full rich-text editing is deferred to the editing overlay system.
 */
import type { ToolContext, ToolCursorState, CursorSpec } from './types';
import { BaseTool } from './BaseTool';

export class TextTool extends BaseTool {
  id = 'text' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'text' };
  }

  override onDragMove(ctx: ToolContext): void {
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      label: `Text ${Math.round(rect.w)} x ${Math.round(rect.h)}`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const rect = this.computeDragRect(ctx);
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const parentId = this.commitToParent(center, ctx);

    if (this.isBelowThreshold(ctx)) {
      ctx.createTextNodeAt(this.drag.startWorld, undefined, parentId, '');
    } else if (rect.w > 0 && rect.h > 0) {
      ctx.createTextNodeAt({ x: rect.x, y: rect.y }, { w: rect.w, h: rect.h }, parentId, '');
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }
}
