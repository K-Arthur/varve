/**
 * KnifeTool — split editable vector objects with a world-space cut line.
 *
 * The gesture is preview-only until pointerup: the cut line is a draft, never a
 * SceneNode, so dragging across a thousand objects still mutates nothing. The
 * editor then commits the whole cut as one document mutation, which is what
 * makes cancel leave no trace and one undo restore every source object.
 *
 * Shift constrains the cut to 45° steps (BaseTool.computeDragLine), and Escape
 * abandons a cut in progress — the pointerup that follows must not commit the
 * abandoned line, hence the explicit `aborted` latch rather than relying on the
 * drag state alone.
 *
 * Research basis: Illustrator Knife, Figma vector editing, W3C Pointer Events.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class KnifeTool extends BaseTool {
  id = 'knife' as const;

  /** Set by Escape so the pointerup that ends the gesture commits nothing. */
  private aborted = false;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragStart(_ctx: ToolContext): void {
    this.aborted = false;
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.aborted) return;
    const line = this.computeDragLine(ctx);
    const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    ctx.setDraft({
      kind: 'line',
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      label: `Cut ${Math.round(length)}`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    if (this.aborted) {
      this.aborted = false;
      return;
    }
    // A press that never became a drag is a click, not a cut. Committing it
    // would run the whole operation against a zero-length line.
    if (this.isBelowThreshold(ctx)) return;
    const line = this.computeDragLine(ctx);
    ctx.sliceWithKnife?.({
      start: [line.x1, line.y1],
      end: [line.x2, line.y2],
    });
  }

  override onDragCancel(ctx: ToolContext): void {
    this.aborted = true;
    ctx.setDraft(null);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    if (this.drag.kind !== 'dragging') return false;
    this.onDragCancel(ctx);
    ctx.announce('Cut cancelled');
    return true;
  }
}
