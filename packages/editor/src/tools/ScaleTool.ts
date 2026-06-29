/**
 * ScaleTool — drag to scale selected nodes proportionally.
 *
 * Gesture: drag away from start point to scale up, toward to scale down.
 * Shift = uniform (equal X and Y scale).
 *
 * Research basis: Figma Scale tool (K), Illustrator Scale tool.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface NodeInitialState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ScaleTool extends BaseTool {
  id = 'scale' as const;

  private initialNodes: NodeInitialState[] = [];
  private uniform = false;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'nwse-resize' };
  }

  override onDragStart(ctx: ToolContext): void {
    this.initialNodes = [];
    this.uniform = ctx.shiftKey;
    for (const id of ctx.selection) {
      const node = ctx.getNode(id);
      if (!node) continue;
      const bbox = ctx.nodeWorldBounds(node);
      if (!bbox) continue;
      this.initialNodes.push({
        id,
        x: bbox.x,
        y: bbox.y,
        w: bbox.w,
        h: bbox.h,
      });
    }
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.initialNodes.length === 0) return;
    const start = this.drag.startWorld;
    const current = this.drag.currentWorld;
    const deltaX = current.x - start.x;
    const deltaY = current.y - start.y;

    for (const init of this.initialNodes) {
      let sx = deltaX / (init.w || 1);
      let sy = deltaY / (init.h || 1);
      const scale = 1 + (sx + sy) / 2;
      if (ctx.shiftKey || this.uniform) {
        sx = scale - 1;
        sy = scale - 1;
      }
      const cx = init.x + init.w / 2;
      const cy = init.y + init.h / 2;
      const newW = Math.max(1, init.w * (1 + sx));
      const newH = Math.max(1, init.h * (1 + sy));
      ctx.setNodePosition(init.id, cx - newW / 2, cy - newH / 2);
      ctx.setNodeSize(init.id, newW, newH);
    }
  }

  override onDragEnd(_ctx: ToolContext): void {
    this.initialNodes = [];
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.initialNodes = [];
  }
}
