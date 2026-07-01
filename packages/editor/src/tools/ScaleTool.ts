/**
 * ScaleTool — Scale selected nodes uniformly by dragging.
 *
 * Gesture: drag away from the centroid to scale up, toward to scale down.
 * The scale factor is computed as the ratio of current distance to initial
 * distance from the selection's centroid, applied to the affine transform.
 *
 * Research basis: Figma Scale tool (K), Illustrator Scale tool.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface NodeInitialState {
  id: string;
  centroidX: number;
  centroidY: number;
}

export class ScaleTool extends BaseTool {
  id = 'scale' as const;

  private initialNodes: NodeInitialState[] = [];
  private selectionCenter = { x: 0, y: 0 };
  private initialDist = 0;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'nwse-resize' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;

    this.initialNodes = [];

    if (ctx.selection.length === 0) return result;

    let cx = 0,
      cy = 0,
      count = 0;
    for (const id of ctx.selection) {
      const node = ctx.getNode(id);
      if (!node) continue;
      const bbox = ctx.nodeWorldBounds(node);
      if (!bbox) continue;
      cx += bbox.x + bbox.w / 2;
      cy += bbox.y + bbox.h / 2;
      count++;
      this.initialNodes.push({
        id,
        centroidX: bbox.x + bbox.w / 2,
        centroidY: bbox.y + bbox.h / 2,
      });
    }
    if (count === 0) return result;
    this.selectionCenter = { x: cx / count, y: cy / count };

    const dx = this.drag.startWorld.x - this.selectionCenter.x;
    const dy = this.drag.startWorld.y - this.selectionCenter.y;
    this.initialDist = Math.sqrt(dx * dx + dy * dy) || 1;
    return result;
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.initialNodes.length === 0 || this.initialDist === 0) return;

    const current = this.drag.currentWorld;
    const dx = current.x - this.selectionCenter.x;
    const dy = current.y - this.selectionCenter.y;
    const currentDist = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = currentDist / this.initialDist;

    for (const init of this.initialNodes) {
      ctx.updateNode(init.id, (node) => {
        const nodeDx = init.centroidX - this.selectionCenter.x;
        const nodeDy = init.centroidY - this.selectionCenter.y;
        const nodeDist = Math.sqrt(nodeDx * nodeDx + nodeDy * nodeDy) || 1;
        const s = 1 + (scale - 1) * (nodeDist / (this.initialDist || 1));
        const clamped = Math.max(0.01, Math.min(100, s));
        return {
          ...node,
          transform: [
            node.transform[0] * clamped,
            node.transform[1],
            node.transform[2],
            node.transform[3] * clamped,
            node.transform[4] - nodeDx * (clamped - 1),
            node.transform[5] - nodeDy * (clamped - 1),
          ] as [number, number, number, number, number, number],
        };
      });
    }
  }

  override onDragEnd(_ctx: ToolContext): void {
    this.initialNodes = [];
    this.initialDist = 0;
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.initialNodes = [];
    this.initialDist = 0;
  }
}
