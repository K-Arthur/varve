/**
 * PanelTool — drag to create a comic panel.
 *
 * A panel is a clipping FrameNode with a solid border and a paper-white
 * interior: artwork the new panel fully covers is captured into it (the same
 * capture-on-draw rule the Frame tool uses), so rough artwork can be turned
 * into a panel layout in one gesture. Panels are shared tool output — the
 * tool composes into any workspace toolbar and is never mode-gated.
 *
 * Below-threshold click → default panel size, like FrameTool.
 * Shift=square, Alt=from-centre.
 *
 * Research basis: Clip Studio Paint frame-border tool, Krita comic templates.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

const DEFAULT_PANEL_W = 400;
const DEFAULT_PANEL_H = 300;

export class PanelTool extends BaseTool {
  id = 'panel' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'frame',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      label: `${Math.round(rect.w)} x ${Math.round(rect.h)}`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const rect = this.computeDragRect(ctx);

    if (this.isBelowThreshold(ctx)) {
      ctx.createShapeAt(
        {
          x: this.drag.startWorld.x - DEFAULT_PANEL_W / 2,
          y: this.drag.startWorld.y - DEFAULT_PANEL_H / 2,
        },
        { w: DEFAULT_PANEL_W, h: DEFAULT_PANEL_H },
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
