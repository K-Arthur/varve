/**
 * PenTool — cubic Bezier path creation.
 *
 * Click → corner point. Click-drag → smooth point with symmetric handles.
 * Alt-drag a handle → break symmetry. Click first point → close path.
 * Enter/Escape/double-click → finish open path.
 * Click existing path endpoint → continue path.
 * Live rubber-band preview of next segment.
 *
 * Research basis: Figma Pen (P), Illustrator Pen (P), Penpot Pen.
 *                 de Casteljau's algorithm, cubic Bezier math.
 */

import { nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import {
  distanceToPathEndpoint,
  pathPointsLocalToWorld,
  pathPointsWorldToLocal,
} from './pathCoords';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface PenPoint {
  x: number;
  y: number;
  handleIn: { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
}

enum PenState {
  Idle,
  Placing, // between points, waiting for next click
  Dragging, // currently dragging from last placed point to create handles
}

const HANDLE_DRAG_THRESHOLD = 3; // CSS pixels before handles appear

export class PenTool extends BaseTool {
  id = 'pen' as const;

  private penState: PenState = PenState.Idle;
  private points: PenPoint[] = [];
  private lastPointTime = 0;
  private dragStartCanvas: { x: number; y: number } | null = null;
  /** When non-null, we're continuing this existing path node. */
  private continuePathId: string | null = null;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(_ctx: ToolContext): void {
    this.penState = PenState.Idle;
    this.points = [];
    this.dragStartCanvas = null;
  }

  override onDeactivate(ctx: ToolContext): void {
    this.penState = PenState.Idle;
    this.points = [];
    this.dragStartCanvas = null;
    this.continuePathId = null;
    ctx.setDraft(null);
  }

  /** Check if a click hits the endpoint of an existing path node. */
  private tryContinueExistingPath(world: { x: number; y: number }, ctx: ToolContext): boolean {
    const hit = ctx.hitTest(world);
    if (!hit) return false;
    const node = ctx.getNode(hit.nodeId);
    if (node?.kind !== 'shape' || node.shape.kind !== 'path') return false;
    const pts = node.shape.points;
    if (pts.length < 1) return false;

    const wm = nodeWorldTransform(ctx.document, hit.nodeId);
    const threshold = 8 / ctx.zoom;
    const distLast = distanceToPathEndpoint(world, pts, wm, 'last');
    const distFirst = distanceToPathEndpoint(world, pts, wm, 'first');
    if (distLast > threshold && distFirst > threshold) return false;

    const worldPts = pathPointsLocalToWorld(pts, wm);
    this.continuePathId = hit.nodeId;
    this.points = worldPts.map((p) => ({
      x: p.x,
      y: p.y,
      handleIn: p.handleIn ? { x: p.handleIn[0], y: p.handleIn[1] } : null,
      handleOut: p.handleOut ? { x: p.handleOut[0], y: p.handleOut[1] } : null,
    }));
    this.penState = PenState.Placing;
    ctx.announce('Continuing path');
    return true;
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);

    if (this.penState === PenState.Idle) {
      if (this.tryContinueExistingPath(world, ctx)) {
        return { consumed: true };
      }
      this.penState = PenState.Dragging;
      this.points = [{ x: world.x, y: world.y, handleIn: null, handleOut: null }];
      this.dragStartCanvas = { x: canvas.x, y: canvas.y };
      ctx.announce('Path started');
      return { consumed: true };
    }

    if (this.penState === PenState.Placing) {
      const first = this.points[0];
      if (!first) throw new Error('first point not found');
      const dist = Math.sqrt((world.x - first.x) ** 2 + (world.y - first.y) ** 2);
      if (dist < 8 / ctx.zoom) {
        this.commitPath(ctx, true);
        ctx.announce('Path closed');
        return { consumed: true };
      }

      const prev = this.points[this.points.length - 1];
      if (!prev) throw new Error('previous point not found');
      const now = Date.now();
      if (now - this.lastPointTime < 300 && this.points.length > 1) {
        this.commitPath(ctx, false);
        ctx.announce('Path finished');
        return { consumed: true };
      }
      this.lastPointTime = now;

      let newPoint: PenPoint;
      if (e.shiftKey) {
        const dx = world.x - prev.x;
        const dy = world.y - prev.y;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.sqrt(dx * dx + dy * dy);
        newPoint = {
          x: prev.x + len * Math.cos(angle),
          y: prev.y + len * Math.sin(angle),
          handleIn: null,
          handleOut: null,
        };
      } else {
        newPoint = { x: world.x, y: world.y, handleIn: null, handleOut: null };
      }

      this.points.push(newPoint);
      this.penState = PenState.Dragging;
      this.dragStartCanvas = { x: canvas.x, y: canvas.y };
      ctx.announce(`Point ${this.points.length}`);
      return { consumed: true };
    }

    return { consumed: false };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.penState === PenState.Dragging && this.dragStartCanvas) {
      const lastIdx = this.points.length - 1;
      if (lastIdx < 0) return;
      const pt = this.points[lastIdx];
      if (!pt) return;

      const world = ctx.canvasToWorld(e.clientX, e.clientY);
      const dragDx = e.clientX - this.dragStartCanvas.x;
      const dragDy = e.clientY - this.dragStartCanvas.y;
      const dragDist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);

      if (dragDist >= HANDLE_DRAG_THRESHOLD) {
        const handleDx = world.x - pt.x;
        const handleDy = world.y - pt.y;
        const handleLen = Math.sqrt(handleDx * handleDx + handleDy * handleDy);
        const outLen = handleLen / 3;

        if (handleLen > 0) {
          let nx = handleDx / handleLen;
          let ny = handleDy / handleLen;
          if (e.shiftKey) {
            // Shift-constrain handle direction to 45° increments
            const angle = Math.round(Math.atan2(ny, nx) / (Math.PI / 4)) * (Math.PI / 4);
            nx = Math.cos(angle);
            ny = Math.sin(angle);
          }
          pt.handleOut = { x: nx * outLen, y: ny * outLen };
          if (e.altKey) {
            // Alt-drag: break symmetry — handleIn retains its previous value
            // (if null, stays null → one-sided/corner handle)
          } else {
            pt.handleIn = { x: -nx * outLen, y: -ny * outLen };
          }
        }
      } else {
        pt.handleIn = null;
        pt.handleOut = null;
      }

      ctx.setDraft({
        kind: 'line',
        x1: pt.x + (pt.handleOut?.x ?? 0),
        y1: pt.y + (pt.handleOut?.y ?? 0),
        x2: world.x,
        y2: world.y,
        label: 'drag to set handles',
      });
      return;
    }

    if (this.penState === PenState.Placing && this.points.length > 0) {
      const world = ctx.canvasToWorld(e.clientX, e.clientY);
      const last = this.points[this.points.length - 1];
      if (!last) return;

      ctx.setDraft({
        kind: 'line',
        x1: last.x,
        y1: last.y,
        x2: world.x,
        y2: world.y,
        label: `to (${Math.round(world.x)}, ${Math.round(world.y)})`,
      });
    }
  }

  override onPointerUp(_e: PointerEvent, _ctx: ToolContext): void {
    if (this.penState === PenState.Dragging) {
      this.penState = PenState.Placing;
      this.dragStartCanvas = null;
    }
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (this.penState === PenState.Placing || this.penState === PenState.Dragging) {
      if (e.key === 'Escape') {
        if (this.penState === PenState.Dragging) {
          this.dragStartCanvas = null;
          if (this.points.length <= 1) {
            this.penState = PenState.Idle;
            this.points = [];
          } else {
            this.penState = PenState.Placing;
          }
          ctx.setDraft(null);
          ctx.announce('Path cancelled');
          return true;
        }
        if (this.points.length > 1) {
          this.dragStartCanvas = null;
          this.commitPath(ctx, false);
          ctx.announce('Path finished');
        } else {
          this.penState = PenState.Idle;
          this.points = [];
          ctx.setDraft(null);
          ctx.announce('Path cancelled');
        }
        return true;
      }
      if (e.key === 'Enter') {
        this.dragStartCanvas = null;
        this.commitPath(ctx, false);
        ctx.announce('Path finished');
        return true;
      }
    }
    return false;
  }

  override onDoubleClick(_e: PointerEvent, ctx: ToolContext): void {
    if (this.penState === PenState.Placing || this.penState === PenState.Dragging) {
      this.dragStartCanvas = null;
      this.commitPath(ctx, false);
      ctx.announce('Path finished');
    }
  }

  private commitPath(ctx: ToolContext, closed: boolean): void {
    ctx.setDraft(null);
    ctx.beginTransaction();
    try {
      if (this.points.length < 2 && !closed) {
        const pt = this.points[0];
        if (!pt) throw new Error('point not found');
        ctx.createShapeAt({ x: pt.x, y: pt.y }, { w: 4, h: 4 });
      } else if (this.points.length >= 2 || closed) {
        const first = this.points[0];
        if (!first) throw new Error('first point not found');
        const pathPoints: import('@varve/engine').PathPoint[] = this.points.map((p) => ({
          x: p.x,
          y: p.y,
          handleIn: p.handleIn ? ([p.handleIn.x, p.handleIn.y] as [number, number]) : null,
          handleOut: p.handleOut ? ([p.handleOut.x, p.handleOut.y] as [number, number]) : null,
        }));
        if (this.continuePathId) {
          const wm = nodeWorldTransform(ctx.document, this.continuePathId);
          const localPoints = pathPointsWorldToLocal(pathPoints, wm);
          ctx.updateNode(this.continuePathId, (n) => {
            if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
            return {
              ...n,
              shape: {
                ...n.shape,
                points: localPoints,
                closed: closed || n.shape.closed,
              },
            } as import('@varve/scene').ShapeNode;
          });
        } else {
          ctx.createShapeAt({ x: first.x, y: first.y }, undefined, undefined, pathPoints, closed);
        }
      }
    } finally {
      ctx.commitTransaction();
    }
    this.penState = PenState.Idle;
    this.points = [];
    this.dragStartCanvas = null;
    this.continuePathId = null;
  }
}
