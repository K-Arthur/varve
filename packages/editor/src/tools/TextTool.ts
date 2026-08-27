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

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

/**
 * Smallest text container a drag may produce, in world units. Sized from the
 * 16px default type: roughly three ems wide and one line tall, which is the
 * point below which the box has no room for a caret.
 */
const MIN_TEXT_BOX_WIDTH = 48;
const MIN_TEXT_BOX_HEIGHT = 23;

export class TextTool extends BaseTool {
  id = 'text' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'text' };
  }

  override onDragMove(ctx: ToolContext): void {
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'rect',
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
      return;
    }
    // A drag along a single axis is still a request for a text box. The
    // threshold above is per-axis, so a purely horizontal sweep cleared it
    // while leaving `rect.h` at zero — the old `w > 0 && h > 0` guard then
    // dropped the gesture and created nothing at all, with no feedback. Clamp
    // instead: a container smaller than one line of type cannot be typed into
    // or clicked anyway.
    ctx.createTextNodeAt(
      { x: rect.x, y: rect.y },
      { w: Math.max(rect.w, MIN_TEXT_BOX_WIDTH), h: Math.max(rect.h, MIN_TEXT_BOX_HEIGHT) },
      parentId,
      '',
    );
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }
}
