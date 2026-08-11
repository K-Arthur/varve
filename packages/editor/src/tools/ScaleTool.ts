/**
 * ScaleTool — Scale selected nodes by dragging.
 *
 * Gesture: drag away from the pivot/centroid to scale up, toward it to scale down.
 * Supports axis-lock (Alt), uniform-snap (Shift), configurable pivot point,
 * and multi-object scale with relative position preservation.
 *
 * Research basis: Figma Scale tool (K), Illustrator Scale tool.
 */

import type { Affine } from '@varve/engine';
import { getParent } from '@varve/scene';
import { multiplyAffine } from '@varve/shared';
import { nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

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
  private initialDx = 0;
  private initialDy = 0;
  private initialUnionBbox: { x: number; y: number; w: number; h: number } | null = null;

  /** Optional custom pivot point. When set, scale origin uses this instead of centroid average. */
  pivot: { x: number; y: number } | null = null;

  /** Set a custom pivot point for the next scale gesture. Pass null to reset to centroid. */
  setPivot(x: number, y: number): void {
    this.pivot = { x, y };
  }

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

    // Use pivot if set, otherwise fall back to centroid average
    const origin = this.pivot ?? this.selectionCenter;
    this.initialDx = this.drag.startWorld.x - origin.x;
    this.initialDy = this.drag.startWorld.y - origin.y;
    this.initialDist =
      Math.sqrt(this.initialDx * this.initialDx + this.initialDy * this.initialDy) || 1;
    ctx.beginTransaction();
    return result;
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.initialNodes.length === 0 || this.initialDist === 0) return;

    const origin = this.pivot ?? this.selectionCenter;
    const current = this.drag.currentWorld;
    const dx = current.x - origin.x;
    const dy = current.y - origin.y;
    const currentDist = Math.sqrt(dx * dx + dy * dy) || 1;

    let scaleX: number;
    let scaleY: number;

    if (ctx.altKey) {
      // Axis lock: determine dominant axis from drag direction
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx > absDy * 2 && Math.abs(this.initialDx) > 0.001) {
        // Horizontal dominance: scale X only
        scaleX = absDx / Math.abs(this.initialDx);
        scaleY = 1;
      } else if (absDy > absDx * 2 && Math.abs(this.initialDy) > 0.001) {
        // Vertical dominance: scale Y only
        scaleY = absDy / Math.abs(this.initialDy);
        scaleX = 1;
      } else {
        // Diagonal or ambiguous: uniform
        scaleX = scaleY = currentDist / this.initialDist;
      }
    } else {
      // Default uniform scale
      scaleX = scaleY = currentDist / this.initialDist;
    }

    // Shift: snap to nearest 0.25 increment
    if (ctx.shiftKey) {
      scaleX = Math.round(scaleX / 0.25) * 0.25;
      scaleY = Math.round(scaleY / 0.25) * 0.25;
    }

    // Clamp
    scaleX = Math.max(0.01, Math.min(100, scaleX));
    scaleY = Math.max(0.01, Math.min(100, scaleY));

    const updaters: Array<{
      id: string;
      update: (node: import('@varve/scene').SceneNode) => import('@varve/scene').SceneNode;
    }> = [];
    // Parent space does not change during one scale sample: cache the
    // rotation-only space matrix per parent so N nodes under one parent pay
    // one ancestor-chain walk instead of N (deeply nested parents otherwise
    // cost O(depth) per node per pointermove).
    const spaceMatCache = new Map<string | null, Affine>();
    const spaceMatFor = (
      node: import('@varve/scene').SceneNode,
      parentId: string | null,
    ): Affine => {
      const cached = spaceMatCache.get(parentId);
      if (cached) return cached;
      let spaceMat: Affine;
      if (parentId) {
        const parentTransform = nodeWorldTransform(ctx.document, parentId);
        const angle = Math.atan2(parentTransform[1], parentTransform[0]);
        spaceMat = [
          Math.cos(angle),
          Math.sin(angle),
          -Math.sin(angle),
          Math.cos(angle),
          0,
          0,
        ] as Affine;
      } else {
        const rot = node.rotation ?? 0;
        if (rot === 0) spaceMat = [1, 0, 0, 1, 0, 0] as Affine;
        const rad = (rot * Math.PI) / 180;
        spaceMat = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0] as Affine;
      }
      spaceMatCache.set(parentId, spaceMat);
      return spaceMat;
    };
    for (const init of this.initialNodes) {
      updaters.push({
        id: init.id,
        update: (node) => {
          const nodeDx = init.centroidX - origin.x;
          const nodeDy = init.centroidY - origin.y;
          const scaleAffine: Affine = [scaleX, 0, 0, scaleY, 0, 0];
          const composed = multiplyAffine(scaleAffine, node.transform as Affine);

          // Map world-space centroid offset into the node's parent local space.
          // This is the correct space for adjusting position after scaling —
          // the node's transform is expressed relative to its parent, so the
          // position adjustment must also be in parent space.
          // For deeply nested objects, we extract only rotation (not translation)
          // from the parent world transform to avoid double-counting position.
          const parentId = ctx.document ? getParent(ctx.document, init.id) : null;
          const spaceMat = spaceMatFor(node, parentId);
          const det = spaceMat[0] * spaceMat[3] - spaceMat[1] * spaceMat[2];
          let localDx = nodeDx;
          let localDy = nodeDy;
          if (Math.abs(det) > 1e-10) {
            localDx = (spaceMat[3] * nodeDx - spaceMat[2] * nodeDy) / det;
            localDy = (-spaceMat[1] * nodeDx + spaceMat[0] * nodeDy) / det;
          }
          const adjustX = localDx * (scaleX - 1);
          const adjustY = localDy * (scaleY - 1);
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
        },
      });
    }
    ctx.updateNodes(updaters);

    // Show scaled bounding box draft with percentage label
    if (this.initialUnionBbox) {
      const b = this.initialUnionBbox;
      const scx = b.x + b.w / 2;
      const scy = b.y + b.h / 2;
      const nw = b.w * scaleX;
      const nh = b.h * scaleY;
      ctx.setDraft({
        kind: 'rect',
        x: scx - nw / 2,
        y: scy - nh / 2,
        w: nw,
        h: nh,
        label: `${Math.round(((scaleX + scaleY) / 2) * 100)}%`,
      });
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    ctx.commitTransaction();
    this.initialNodes = [];
    this.initialDist = 0;
    this.initialUnionBbox = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    ctx.abortTransaction();
    this.initialNodes = [];
    this.initialDist = 0;
    this.initialUnionBbox = null;
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.drag.kind === 'dragging') {
      ctx.abortTransaction();
      ctx.setDraft(null);
      this.initialNodes = [];
      this.initialDist = 0;
      this.initialUnionBbox = null;
      this.drag = {
        kind: 'idle',
        pointerId: -1,
        startCanvas: { x: 0, y: 0 },
        startWorld: { x: 0, y: 0 },
        currentCanvas: { x: 0, y: 0 },
        currentWorld: { x: 0, y: 0 },
      };
    }
  }
}
