/**
 * NodeEditTool — path anchor editing mode.
 *
 * Activated by double-clicking a path/bezier ShapeNode in SelectTool.
 * Manages per-anchor selection, drag-move, delete, and corner/smooth toggle.
 * Exits back to 'select' on Escape or V.
 */
import type { Affine, PathPoint } from '@strata/engine';
import { applyAffine, invertAffine } from '@strata/engine';
import { nodeWorldTransform } from '../scene/world';
import type { ShapeNode } from '@strata/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

const ANCHOR_HIT_RADIUS = 8;

export class NodeEditTool extends BaseTool {
  id = 'nodeEdit' as const;

  private selectedAnchors: Set<number> = new Set();
  private draggingAnchorIdx: number | null = null;
  private dragStartAnchorPos: { x: number; y: number } | null = null;
  private dragStartWorld: { x: number; y: number } | null = null;

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'move' };
    return { css: 'crosshair' };
  }

  override onDeactivate(ctx: ToolContext): void {
    ctx.setNodeEditTargetId(null);
    this.selectedAnchors.clear();
    this.draggingAnchorIdx = null;
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return { consumed: false };

    const node = ctx.getNode(targetId);
    if (!node || node.kind !== 'shape' || node.shape.kind !== 'path') {
      return { consumed: false };
    }

    // Convert world pointer to node's local space using full inverse world transform.
    // This correctly handles rotated/scaled nodes and nodes inside frames.
    const worldMat = nodeWorldTransform(ctx.document, targetId);
    const invWorld = invertAffine(worldMat);
    const local = applyAffine(invWorld, [world.x, world.y]);
    const hit = findNearestAnchorLocal(node.shape.points, local, ANCHOR_HIT_RADIUS);

    if (hit !== null) {
      if (!e.shiftKey) this.selectedAnchors.clear();
      this.selectedAnchors.add(hit);
      ctx.setNodeEditSelectedAnchors(new Set(this.selectedAnchors));
      this.draggingAnchorIdx = hit;
      const pt = node.shape.points[hit]!;
      this.dragStartAnchorPos = { x: pt.x, y: pt.y };
      this.dragStartWorld = world;
      this.drag = {
        kind: 'dragging',
        pointerId: e.pointerId,
        startCanvas: { x: e.clientX, y: e.clientY },
        startWorld: world,
        currentCanvas: { x: e.clientX, y: e.clientY },
        currentWorld: world,
      };
    } else {
      if (!e.shiftKey) {
        this.selectedAnchors.clear();
        ctx.setNodeEditSelectedAnchors(new Set());
      }
      this.draggingAnchorIdx = null;
    }

    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.draggingAnchorIdx === null || !this.dragStartAnchorPos || !this.dragStartWorld) return;
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;

    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return;

    // Convert both start and current world positions to node-local space.
    // The delta in local space is the correct anchor displacement regardless
    // of the node's rotation, scale, or parent transforms.
    const worldMat = nodeWorldTransform(ctx.document, targetId);
    const invWorld = invertAffine(worldMat);
    const current = ctx.canvasToWorld(e.clientX, e.clientY);
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = current;

    const localStart = applyAffine(invWorld, [this.dragStartWorld.x, this.dragStartWorld.y]);
    const localCurrent = applyAffine(invWorld, [current.x, current.y]);
    const dx = localCurrent[0] - localStart[0];
    const dy = localCurrent[1] - localStart[1];
    const newX = this.dragStartAnchorPos.x + dx;
    const newY = this.dragStartAnchorPos.y + dy;

    const anchorIdx = this.draggingAnchorIdx;

    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const points = n.shape.points.map((p, i) =>
        i === anchorIdx ? { ...p, x: newX, y: newY } : p,
      );
      return { ...n, shape: { ...n.shape, points } } as ShapeNode;
    });
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    ctx.releasePointerCapture(e.pointerId);
    this.draggingAnchorIdx = null;
    this.dragStartAnchorPos = null;
    this.dragStartWorld = null;
    this.drag = {
      kind: 'idle',
      pointerId: -1,
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 0, y: 0 },
      currentWorld: { x: 0, y: 0 },
    };
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' || e.key === 'v') {
      ctx.setTool('select');
      return true;
    }

    if (e.key === 'Backspace') {
      return this.deleteSelectedAnchors(ctx);
    }

    if (e.key === 'c' || e.key === 'C') {
      return this.toggleCornerSmooth(ctx);
    }

    return false;
  }

  private deleteSelectedAnchors(ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;
    const node = ctx.getNode(targetId);
    if (!node || node.kind !== 'shape' || node.shape.kind !== 'path') return false;
    if (node.shape.points.length - this.selectedAnchors.size < 2) return false;

    const toRemove = new Set(this.selectedAnchors);
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const points = n.shape.points.filter((_, i) => !toRemove.has(i));
      return { ...n, shape: { ...n.shape, points } } as ShapeNode;
    });
    this.selectedAnchors.clear();
    ctx.setNodeEditSelectedAnchors(new Set());
    return true;
  }

  private toggleCornerSmooth(ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;

    const toToggle = new Set(this.selectedAnchors);
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const points: PathPoint[] = n.shape.points.map((p, i) => {
        if (!toToggle.has(i)) return p;
        if (p.handleIn === null && p.handleOut === null) {
          return {
            ...p,
            handleIn: [-20, 0] as [number, number],
            handleOut: [20, 0] as [number, number],
          };
        }
        return { ...p, handleIn: null, handleOut: null };
      });
      return { ...n, shape: { ...n.shape, points } } as ShapeNode;
    });
    return true;
  }

  /** Returns current selected anchor indices (for overlay rendering). */
  getSelectedAnchors(): ReadonlySet<number> {
    return this.selectedAnchors;
  }
}

function findNearestAnchorLocal(
  points: PathPoint[],
  local: readonly [number, number],
  radius: number,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const dx = local[0] - p.x;
    const dy = local[1] - p.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < bestDist) {
      bestDist = dist2;
      best = i;
    }
  }
  return best;
}
