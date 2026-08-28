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
    const rings = pathRings(node.shape);
    const handleHit = findNearestHandle(rings, local, handleRadiusLocal);
    const anchorHit = findNearestAnchorLocal(rings, local, anchorRadiusLocal);

    if (handleHit !== null && anchorHit !== null && anchorHit === handleHit.anchorIdx) {
      // Both within radius of the same anchor — anchor hit takes priority.
      // This avoids accidental handle grabs when the user intends to move the anchor.
    } else if (handleHit !== null) {
      // Handle hit, no competing anchor hit
      this.beginEditTransaction(ctx);
      if (!e.shiftKey) this.selectedAnchors.clear();
      ctx.setNodeEditSelectedAnchors(new Set(this.selectedAnchors));
      const pt = pointAtGlobalIndex(rings, handleHit.anchorIdx);
      if (!pt) return { consumed: true, captured: true };
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
      const pt = pointAtGlobalIndex(rings, anchorHit);
      if (!pt) return { consumed: true, captured: true };
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
        // Update the selected anchor in whichever contour it belongs to.
        return {
          ...n,
          shape: updatePathPoint(n.shape, anchorIdx, (p) => {
            if (which === 'in') {
              const updated = { ...p, handleIn: [newHandle0, newHandle1] as [number, number] };
              if (!this.altDragStarted) {
                updated.handleOut = [-newHandle0, -newHandle1] as [number, number];
              }
              return updated;
            }
            const updated = { ...p, handleOut: [newHandle0, newHandle1] as [number, number] };
            if (!this.altDragStarted && p.handleIn) {
              updated.handleIn = [-newHandle0, -newHandle1] as [number, number];
            }
            return updated;
          }),
        } as ShapeNode;
      });
      return;
    }

    if (this.draggingAnchorIdx === null || !this.dragStartAnchorPos || !this.dragStartWorld) return;

    const newX = this.dragStartAnchorPos.x + dx;
    const newY = this.dragStartAnchorPos.y + dy;
    const anchorIdx = this.draggingAnchorIdx;

    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const shape = updatePathPoint(n.shape, anchorIdx, (p) => ({ ...p, x: newX, y: newY }));
      return { ...n, shape } as ShapeNode;
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
    const rings = pathRings(node.shape);
    const removals = new Map<number, Set<number>>();
    for (const globalIndex of this.selectedAnchors) {
      const location = locateGlobalIndex(rings, globalIndex);
      if (!location) continue;
      const indices = removals.get(location.ringIndex) ?? new Set<number>();
      indices.add(location.pointIndex);
      removals.set(location.ringIndex, indices);
    }
    for (const [ringIndex, indices] of removals) {
      const ring = rings[ringIndex]!;
      const minimum = ringIndex === 0 ? 2 : 3;
      if (ring.length - indices.size < minimum) return false;
    }

    ctx.beginTransaction();
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const currentRings = pathRings(n.shape);
      const points = currentRings[0]!.filter((_, i) => !removals.get(0)?.has(i));
      const holes = currentRings
        .slice(1)
        .map((ring, i) => ring.filter((_, pointIndex) => !removals.get(i + 1)?.has(pointIndex)));
      return {
        ...n,
        shape: { ...n.shape, points, ...(n.shape.holes ? { holes } : {}) },
      } as ShapeNode;
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
      const rings = pathRings(s);
      let offset = 0;
      const updatedRings = rings.map((ring) => {
        const ringOffset = offset;
        offset += ring.length;
        return ring.map((p, i) => {
          if (!toToggle.has(ringOffset + i)) return p;
          if (p.handleIn === null && p.handleOut === null) {
            const len = computeDefaultHandleLength(ring, i);
            const prevDir = computeHandleDirection(ring, i, 'prev');
            const nextDir = computeHandleDirection(ring, i, 'next');
            return {
              ...p,
              handleIn: [prevDir[0] * len, prevDir[1] * len] as [number, number],
              handleOut: [nextDir[0] * len, nextDir[1] * len] as [number, number],
            };
          }
          return { ...p, handleIn: null, handleOut: null };
        });
      });
      return {
        ...n,
        shape: {
          ...s,
          points: updatedRings[0]!,
          ...(s.holes ? { holes: updatedRings.slice(1) } : {}),
        },
      } as ShapeNode;
    });
    return true;
  }

  /** Returns current selected anchor indices (for overlay rendering). */
  getSelectedAnchors(): ReadonlySet<number> {
    return this.selectedAnchors;
  }
}

function pathRings(shape: Extract<ShapeNode['shape'], { kind: 'path' }>): PathPoint[][] {
  return [shape.points, ...(shape.holes ?? [])];
}

function locateGlobalIndex(
  rings: PathPoint[][],
  globalIndex: number,
): { ringIndex: number; pointIndex: number } | null {
  let offset = 0;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex]!;
    if (globalIndex >= offset && globalIndex < offset + ring.length) {
      return { ringIndex, pointIndex: globalIndex - offset };
    }
    offset += ring.length;
  }
  return null;
}

function pointAtGlobalIndex(rings: PathPoint[][], globalIndex: number): PathPoint | null {
  const location = locateGlobalIndex(rings, globalIndex);
  return location ? (rings[location.ringIndex]![location.pointIndex] ?? null) : null;
}

function updatePathPoint(
  shape: Extract<ShapeNode['shape'], { kind: 'path' }>,
  globalIndex: number,
  update: (point: PathPoint) => PathPoint,
): Extract<ShapeNode['shape'], { kind: 'path' }> {
  const rings = pathRings(shape);
  const location = locateGlobalIndex(rings, globalIndex);
  if (!location) return shape;
  const updatedRings = rings.map((ring, ringIndex) =>
    ring.map((point, pointIndex) =>
      ringIndex === location.ringIndex && pointIndex === location.pointIndex
        ? update(point)
        : point,
    ),
  );
  return {
    ...shape,
    points: updatedRings[0]!,
    ...(shape.holes ? { holes: updatedRings.slice(1) } : {}),
  };
}

function findNearestAnchorLocal(
  rings: PathPoint[][],
  local: readonly [number, number],
  radius: number,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  let offset = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const dx = local[0] - p.x;
      const dy = local[1] - p.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < bestDist) {
        bestDist = dist2;
        best = offset + i;
      }
    }
    offset += ring.length;
  }
  return best;
}

function findNearestHandle(
  rings: PathPoint[][],
  local: readonly [number, number],
  radius: number,
): { anchorIdx: number; which: 'in' | 'out' } | null {
  const r2 = radius * radius;
  let best: { anchorIdx: number; which: 'in' | 'out' } | null = null;
  let bestDist = r2;
  let offset = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      if (p.handleIn) {
        const hx = p.x + p.handleIn[0];
        const hy = p.y + p.handleIn[1];
        const dx = local[0] - hx;
        const dy = local[1] - hy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          best = { anchorIdx: offset + i, which: 'in' };
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
          best = { anchorIdx: offset + i, which: 'out' };
        }
      }
    }
    offset += ring.length;
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
