/**
 * LineTool — drag start→end, Shift=45° increments, Alt=from-center.
 *
 * With an active isometric construction plane, Shift constrains the angle to
 * 45° multiples **in plane coordinates** (so a line can follow a plane axis
 * exactly), and Alt mirrors through the start point as usual.
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
    const line = this.resolvedLine(ctx);
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.round(Math.atan2(dy, dx) * (180 / Math.PI));
    ctx.setDraft({
      kind: 'line',
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      label: `${Math.round(len)}px · ${angle}°`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const line = this.resolvedLine(ctx);
    const parentId = this.commitToParent({ x: line.x1, y: line.y1 }, ctx);

    if (this.isBelowThreshold(ctx)) {
      ctx.createShapeAt(this.drag.startWorld, undefined, parentId);
    } else {
      // Position the node at the start point and use signed deltas
      // so from:[0,0] = actual start point and to:[dx,dy] = actual end point.
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      ctx.createShapeAt({ x: line.x1, y: line.y1 }, { w: dx || 4, h: dy || 4 }, parentId);
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  /**
   * The drag line, resolved in plane coordinates when the plane changes the
   * constraint result. Falls back to the base implementation otherwise.
   */
  private resolvedLine(ctx: ToolContext): { x1: number; y1: number; x2: number; y2: number } {
    const toPlane = ctx.worldToPlane;
    const toWorld = ctx.planeToWorld;
    if (!ctx.activeConstructionPlane || !toPlane || !toWorld || (!ctx.shiftKey && !ctx.altKey)) {
      return this.computeDragLine(ctx);
    }
    const start = toPlane(this.drag.startWorld);
    const current = toPlane(this.drag.currentWorld);
    if (!start || !current) return this.computeDragLine(ctx);

    let u = current.u;
    let v = current.v;
    if (ctx.shiftKey) {
      const angle = Math.atan2(v - start.v, u - start.u);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const length = Math.hypot(u - start.u, v - start.v);
      u = start.u + length * Math.cos(snapped);
      v = start.v + length * Math.sin(snapped);
    }
    const startWorld = toWorld({ u: start.u, v: start.v });
    const endWorld = toWorld({ u, v });
    if (!startWorld || !endWorld) return this.computeDragLine(ctx);
    if (ctx.altKey) {
      const dx = endWorld.x - startWorld.x;
      const dy = endWorld.y - startWorld.y;
      return {
        x1: startWorld.x - dx,
        y1: startWorld.y - dy,
        x2: startWorld.x + dx,
        y2: startWorld.y + dy,
      };
    }
    return { x1: startWorld.x, y1: startWorld.y, x2: endWorld.x, y2: endWorld.y };
  }
}
