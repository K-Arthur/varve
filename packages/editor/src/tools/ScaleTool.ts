/**
 * ScaleTool — Scale selected nodes uniformly by dragging.
 *
 * Gesture: drag away from the centroid to scale up, toward to scale down.
 * The scale factor is computed as the ratio of current distance to initial
 * distance from the selection's centroid, applied to the affine transform.
 *
 * Research basis: Figma Scale tool (K), Illustrator Scale tool.
 */

import { multiplyAffine } from '@strata/shared';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';
import type { Affine } from '@strata/engine';

interface NodeInitialState {
  id: string;
  centroidX: number;
  centroidY: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export class ScaleTool extends BaseTool {
  id = 'scale' as const;

  private initialNodes: NodeInitialState[] = [];
  private selectionCenter = { x: 0, y: 0 };
  private initialDist = 0;
  private initialUnionBbox: { x: number; y: number; w: number; h: number } | null = null;

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
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of ctx.selection) {
      const node = ctx.getNode(id);
      if (!node) continue;
      const bbox = ctx.nodeWorldBounds(node);
      if (!bbox) continue;
      cx += bbox.x + bbox.w / 2;
      cy += bbox.y + bbox.h / 2;
      if (bbox.x < minX) minX = bbox.x;
      if (bbox.y < minY) minY = bbox.y;
      if (bbox.x + bbox.w > maxX) maxX = bbox.x + bbox.w;
      if (bbox.y + bbox.h > maxY) maxY = bbox.y + bbox.h;
      count++;
      this.initialNodes.push({
        id,
        centroidX: bbox.x + bbox.w / 2,
        centroidY: bbox.y + bbox.h / 2,
        bbox,
      });
    }
    if (count === 0) return result;
    this.selectionCenter = { x: cx / count, y: cy / count };
    this.initialUnionBbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

    const startDx = this.drag.startWorld.x - this.selectionCenter.x;
    const startDy = this.drag.startWorld.y - this.selectionCenter.y;
    this.initialDist = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
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
        const clamped = Math.max(0.01, Math.min(100, scale));
        const scaleAffine: Affine = [clamped, 0, 0, clamped, 0, 0];
        const composed = multiplyAffine(scaleAffine, node.transform as Affine);
        const adjustX = nodeDx * (clamped - 1);
        const adjustY = nodeDy * (clamped - 1);
        return {
          ...node,
          transform: [
            composed[0],
            composed[1],
            composed[2],
            composed[3],
            composed[4] - adjustX,
            composed[5] - adjustY,
          ] as Affine,
        };
      });
    }

    // Show scaled bounding box draft with percentage label
    if (this.initialUnionBbox) {
      const b = this.initialUnionBbox;
      const scx = b.x + b.w / 2;
      const scy = b.y + b.h / 2;
      const nw = b.w * scale;
      const nh = b.h * scale;
      ctx.setDraft({
        kind: 'rect',
        x: scx - nw / 2,
        y: scy - nh / 2,
        w: nw,
        h: nh,
        label: `${Math.round(scale * 100)}%`,
      });
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.initialNodes = [];
    this.initialDist = 0;
    this.initialUnionBbox = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.initialNodes = [];
    this.initialDist = 0;
    this.initialUnionBbox = null;
  }
}
