/**
 * NodeEditTool — path anchor editing mode.
 *
 * Activated by double-clicking a path/bezier ShapeNode in SelectTool.
 * Manages per-anchor selection, drag-move, delete, and corner/smooth toggle.
 * Exits back to 'select' on Escape or V.
 */
import type { PathPoint } from '@varve/engine';
import { applyAffine, invertAffine } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import { nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

const ANCHOR_HIT_RADIUS = 8;
const HANDLE_HIT_RADIUS = 6;

export class NodeEditTool extends BaseTool {
  id = 'nodeEdit' as const;

  private selectedAnchors: Set<number> = new Set();
  private draggingAnchorIdx: number | null = null;
  private dragStartAnchorPos: { x: number; y: number } | null = null;
  private dragStartWorld: { x: number; y: number } | null = null;
  private draggingHandle: { anchorIdx: number; which: 'in' | 'out' } | null = null;
  private dragStartHandleValue: [number, number] | null = null;
  private inTransaction = false;
  private altDragStarted = false;

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'move' };
    return { css: 'crosshair' };
  }

  override onDeactivate(ctx: ToolContext): void {
    this.endEditTransaction(ctx);
    ctx.setNodeEditTargetId(null);
    this.selectedAnchors.clear();
    this.draggingAnchorIdx = null;
    this.draggingHandle = null;
    this.dragStartHandleValue = null;
    this.altDragStarted = false;
  }

  private beginEditTransaction(ctx: ToolContext): void {
    if (!this.inTransaction) {
      ctx.beginTransaction();
      this.inTransaction = true;
    }
  }

  private endEditTransaction(ctx: ToolContext): void {
    if (this.inTransaction) {
      ctx.commitTransaction();
      this.inTransaction = false;
    }
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return { consumed: false };

    const node = ctx.getNode(targetId);
    if (node?.kind !== 'shape' || node.shape.kind !== 'path') {
      return { consumed: false };
    }

    // Convert world pointer to node's local space using full inverse world transform.
    // This correctly handles rotated/scaled nodes and nodes inside frames.
    const worldMat = nodeWorldTransform(ctx.document, targetId);
    const invWorld = invertAffine(worldMat);
    const local = applyAffine(invWorld, [world.x, world.y]);

    // Screen-space hit radii converted to node-local units: the pointer is
    // compared against anchors in LOCAL space, so the CSS-pixel radius must
    // be divided by zoom (screen→world) and the node's world scale
    // (world→local). Without this, a 10× scaled node gets an effective
    // 80 px screen hit radius and a 0.1-zoom canvas becomes unclickable.
    const worldScaleX = Math.hypot(worldMat[0], worldMat[1]) || 1;
    const anchorRadiusLocal = ANCHOR_HIT_RADIUS / ctx.zoom / worldScaleX;
    const handleRadiusLocal = HANDLE_HIT_RADIUS / ctx.zoom / worldScaleX;

    // Check handle hit first (handles have smaller radius 6px vs anchor 8px,
    // but we check handles first so they take priority when the user clicks
    // near a handle control point even if it's also within anchor radius).
    const handleHit = findNearestHandle(node.shape.points, local, handleRadiusLocal);
    const anchorHit = findNearestAnchorLocal(node.shape.points, local, anchorRadiusLocal);

    if (handleHit !== null && anchorHit !== null && anchorHit === handleHit.anchorIdx) {
      // Both within radius of the same anchor — anchor hit takes priority.
      // This avoids accidental handle grabs when the user intends to move the anchor.
    } else if (handleHit !== null) {
      // Handle hit, no competing anchor hit
      this.beginEditTransaction(ctx);
      if (!e.shiftKey) this.selectedAnchors.clear();
      ctx.setNodeEditSelectedAnchors(new Set(this.selectedAnchors));
      const pt = node.shape.points[handleHit.anchorIdx]!;
      const wasAlt = e.altKey;
      this.draggingHandle = handleHit;
      this.dragStartHandleValue = [
        ...(handleHit.which === 'in' ? pt.handleIn! : pt.handleOut!),
      ] as [number, number];
      this.dragStartWorld = world;
      // Store whether Alt key was held at drag start (breaks symmetry)
      this.altDragStarted = wasAlt;
      this.drag = {
        kind: 'dragging',
        pointerId: e.pointerId,
        startCanvas: { x: e.clientX, y: e.clientY },
        startWorld: world,
        currentCanvas: { x: e.clientX, y: e.clientY },
        currentWorld: world,
      };
      return { consumed: true, captured: true };
    }

    if (anchorHit !== null) {
      this.beginEditTransaction(ctx);
      if (!e.shiftKey) this.selectedAnchors.clear();
      this.selectedAnchors.add(anchorHit);
      ctx.setNodeEditSelectedAnchors(new Set(this.selectedAnchors));
      this.draggingAnchorIdx = anchorHit;
      const pt = node.shape.points[anchorHit]!;
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
      this.endEditTransaction(ctx);
    }

    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;

    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return;

    // Convert both start and current world positions to node-local space.
    // The delta in local space is the correct displacement regardless
    // of the node's rotation, scale, or parent transforms.
    const worldMat = nodeWorldTransform(ctx.document, targetId);
    const invWorld = invertAffine(worldMat);
    const current = ctx.canvasToWorld(e.clientX, e.clientY);
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = current;

    const dw = this.dragStartWorld;
    if (!dw) return;
    const localStart = applyAffine(invWorld, [dw.x, dw.y]);
    const localCurrent = applyAffine(invWorld, [current.x, current.y]);
    const dx = localCurrent[0] - localStart[0];
    const dy = localCurrent[1] - localStart[1];

    if (this.draggingHandle !== null && this.dragStartHandleValue) {
      // Handle drag: update handleIn/handleOut values
      const { anchorIdx, which } = this.draggingHandle;
      const newHandle0 = this.dragStartHandleValue[0] + dx;
      const newHandle1 = this.dragStartHandleValue[1] + dy;
      ctx.updateNode(targetId, (n) => {
        if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
        const points: PathPoint[] = n.shape.points.map((p, i) => {
          if (i !== anchorIdx) return p;
          if (which === 'in') {
            const updated = { ...p, handleIn: [newHandle0, newHandle1] as [number, number] };
            // Alt-drag: don't mirror to handleOut (break symmetry)
            if (!this.altDragStarted) {
              updated.handleOut = [-newHandle0, -newHandle1] as [number, number];
            }
            return updated;
          }
          const updated = { ...p, handleOut: [newHandle0, newHandle1] as [number, number] };
          // Alt-drag: don't mirror to handleIn (break symmetry)
          if (!this.altDragStarted) {
            if (p.handleIn) {
              updated.handleIn = [-newHandle0, -newHandle1] as [number, number];
            }
          }
          return updated;
        });
        return { ...n, shape: { ...n.shape, points } } as ShapeNode;
      });
      return;
    }

    if (this.draggingAnchorIdx === null || !this.dragStartAnchorPos || !this.dragStartWorld) return;

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
    this.endEditTransaction(ctx);
    this.draggingAnchorIdx = null;
    this.dragStartAnchorPos = null;
    this.dragStartWorld = null;
    this.draggingHandle = null;
    this.dragStartHandleValue = null;
    this.altDragStarted = false;
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
    if (node?.kind !== 'shape' || node.shape.kind !== 'path') return false;
    if (node.shape.points.length - this.selectedAnchors.size < 2) return false;

    const toRemove = new Set(this.selectedAnchors);
    ctx.beginTransaction();
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const points = n.shape.points.filter((_, i) => !toRemove.has(i));
      return { ...n, shape: { ...n.shape, points } } as ShapeNode;
    });
    ctx.commitTransaction();
    this.selectedAnchors.clear();
    ctx.setNodeEditSelectedAnchors(new Set());
    return true;
  }

  private toggleCornerSmooth(ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;

    const toToggle = new Set(this.selectedAnchors);
    // Read the current points before mapping so computeDefaultHandleLength
    // can see the original array.
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const s = n.shape;
      const points: PathPoint[] = s.points.map((p, i) => {
        if (!toToggle.has(i)) return p;
        if (p.handleIn === null && p.handleOut === null) {
          const len = computeDefaultHandleLength(s.points, i);
          // handleIn points toward the previous point (negative of forward direction),
          // handleOut points toward the next point.
          const prevDir = computeHandleDirection(s.points, i, 'prev');
          const nextDir = computeHandleDirection(s.points, i, 'next');
          return {
            ...p,
            handleIn: [prevDir[0] * len, prevDir[1] * len] as [number, number],
            handleOut: [nextDir[0] * len, nextDir[1] * len] as [number, number],
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

function findNearestHandle(
  points: PathPoint[],
  local: readonly [number, number],
  radius: number,
): { anchorIdx: number; which: 'in' | 'out' } | null {
  const r2 = radius * radius;
  let best: { anchorIdx: number; which: 'in' | 'out' } | null = null;
  let bestDist = r2;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.handleIn) {
      const hx = p.x + p.handleIn[0];
      const hy = p.y + p.handleIn[1];
      const dx = local[0] - hx;
      const dy = local[1] - hy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = { anchorIdx: i, which: 'in' };
      }
    }
    if (p.handleOut) {
      const hx = p.x + p.handleOut[0];
      const hy = p.y + p.handleOut[1];
      const dx = local[0] - hx;
      const dy = local[1] - hy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = { anchorIdx: i, which: 'out' };
      }
    }
  }
  return best;
}

function computeDefaultHandleLength(points: PathPoint[], idx: number): number {
  const prev = idx > 0 ? points[idx - 1] : null;
  const next = idx < points.length - 1 ? points[idx + 1] : null;
  const p = points[idx]!;

  let len = 20;
  if (prev) {
    len = Math.sqrt((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2) / 3;
  }
  if (next) {
    const nextLen = Math.sqrt((next.x - p.x) ** 2 + (next.y - p.y) ** 2) / 3;
    len = Math.min(len, nextLen);
  }
  return Math.max(len, 4);
}

function computeHandleDirection(
  points: PathPoint[],
  idx: number,
  dir: 'prev' | 'next',
): [number, number] {
  const p = points[idx]!;
  if (dir === 'prev' && idx > 0) {
    const prev = points[idx - 1]!;
    const dx = prev.x - p.x;
    const dy = prev.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }
  if (dir === 'next' && idx < points.length - 1) {
    const next = points[idx + 1]!;
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }
  // Fallback: no adjacent point — use horizontal right
  if (dir === 'next') return [1, 0];
  return [-1, 0];
}
