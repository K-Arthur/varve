/**
 * NodeEditTool — transactional anchor, handle, and segment editing.
 *
 * Pointer presses select first. A gesture becomes document-mutating only after
 * the CSS-pixel drag threshold is crossed, which keeps selection-only clicks
 * out of history. Every mutation is calculated from the pre-gesture shape so
 * high-frequency pointer events do not accumulate rounding or stale indices.
 */
import type { PathPoint } from '@varve/engine';
import { applyAffine } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import {
  type Affine,
  areFinitePathRings,
  bendPathSegment,
  deleteSelectedAnchorsFromPath,
  insertPointOnPath,
  locatePathIndex,
  nodeModeForPoint,
  type PathNodeMode,
  pathPointAtIndex,
  pathRings,
  remapSelectionAfterInsertion,
  setNodeModeAtIndex,
  translateSelectedAnchors,
  tryInvertAffine,
  withPathRings,
} from '@varve/shared';
import { getNudgeStep, type NudgeDirection } from '../commands/nudge';
import { findPathTopologyDependency, pathTopologyBlockMessage } from '../pathTopologyDependencies';
import { nodeWorldTransform } from '../scene/world';
import { loadSettings } from '../settings';
import { BaseTool } from './BaseTool';
import { findNodeEditHit, type NodeEditHit } from './nodeEditGeometry';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

type PathShape = Extract<ShapeNode['shape'], { kind: 'path' }>;

interface PointerGestureBase {
  pointerId: number;
  targetId: string;
  baseShape: PathShape;
  selected: Set<number>;
  startWorld: { x: number; y: number };
  startLocal: [number, number];
  inverseWorld: Affine;
  startCanvas: { x: number; y: number };
  active: boolean;
}

type PointerGesture =
  | (PointerGestureBase & { kind: 'anchor'; anchorIdx: number })
  | (PointerGestureBase & {
      kind: 'handle';
      anchorIdx: number;
      which: 'in' | 'out';
      startHandle: [number, number];
      startMode: PathNodeMode;
    })
  | (PointerGestureBase & {
      kind: 'segment';
      ringIndex: number;
      segmentIndex: number;
    });

const DRAG_THRESHOLD_CSS_PX = 3;

function nudgeDirectionForKey(key: string): NudgeDirection | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

function nudgeDelta(direction: NudgeDirection, step: number): { x: number; y: number } {
  switch (direction) {
    case 'left':
      return { x: -step, y: 0 };
    case 'right':
      return { x: step, y: 0 };
    case 'up':
      return { x: 0, y: -step };
    case 'down':
      return { x: 0, y: step };
  }
}

function idleDrag() {
  return {
    kind: 'idle' as const,
    pointerId: -1,
    startCanvas: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
    currentCanvas: { x: 0, y: 0 },
    currentWorld: { x: 0, y: 0 },
  };
}

function clonePathShape(shape: PathShape): PathShape {
  return withPathRings({ ...shape }, pathRings(shape));
}

function finiteAffine(matrix: Affine): boolean {
  return matrix.every(Number.isFinite);
}

function safeInverse(matrix: Affine): Affine | null {
  if (!finiteAffine(matrix)) return null;
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const linearScale = Math.max(
    Math.abs(matrix[0]),
    Math.abs(matrix[1]),
    Math.abs(matrix[2]),
    Math.abs(matrix[3]),
    1,
  );
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= Number.EPSILON * linearScale ** 2 * 64
  ) {
    return null;
  }
  const inverse = tryInvertAffine(matrix);
  return inverse && finiteAffine(inverse) ? inverse : null;
}

function pathNode(
  ctx: ToolContext,
  targetId: string,
): { node: ShapeNode; shape: PathShape } | null {
  const node = ctx.getNode(targetId);
  if (node?.kind !== 'shape' || node.shape.kind !== 'path') return null;
  return { node, shape: node.shape };
}

function pointerScreen(ctx: ToolContext, event: PointerEvent): { x: number; y: number } {
  return (
    ctx.pointerToCanvas?.(event.clientX, event.clientY) ?? {
      x: event.clientX,
      y: event.clientY,
    }
  );
}

function screenDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function localDelta(
  inverseWorld: Affine,
  startWorld: { x: number; y: number },
  currentWorld: { x: number; y: number },
): [number, number] | null {
  const start = applyAffine(inverseWorld, [startWorld.x, startWorld.y]);
  const current = applyAffine(inverseWorld, [currentWorld.x, currentWorld.y]);
  const delta: [number, number] = [current[0] - start[0], current[1] - start[1]];
  return delta.every(Number.isFinite) ? delta : null;
}

function handleLength(handle: readonly [number, number] | null): number {
  return handle ? Math.hypot(handle[0], handle[1]) : 0;
}

function moveHandle(
  point: PathPoint,
  which: 'in' | 'out',
  startHandle: readonly [number, number],
  delta: readonly [number, number],
  startMode: PathNodeMode,
  altKey: boolean,
): PathPoint {
  const moved: [number, number] = [startHandle[0] + delta[0], startHandle[1] + delta[1]];
  const mode = altKey ? 'corner' : startMode === 'automatic' ? 'smooth' : startMode;
  const next: PathPoint = {
    ...point,
    [which === 'in' ? 'handleIn' : 'handleOut']: moved,
    mode,
  };
  if (altKey || mode === 'corner') return next;

  const oppositeWhich = which === 'in' ? 'handleOut' : 'handleIn';
  const opposite = which === 'in' ? point.handleOut : point.handleIn;
  const movedLength = handleLength(moved);
  const oppositeLength = mode === 'symmetric' ? movedLength : handleLength(opposite) || movedLength;
  if (movedLength <= Number.EPSILON || oppositeLength <= Number.EPSILON) {
    next[oppositeWhich] = [0, 0];
    return next;
  }
  const unitX = moved[0] / movedLength;
  const unitY = moved[1] / movedLength;
  next[oppositeWhich] = [-unitX * oppositeLength, -unitY * oppositeLength];
  return next;
}

export class NodeEditTool extends BaseTool {
  id = 'nodeEdit' as const;

  private selectedAnchors: Set<number> = new Set();
  private pointerGesture: PointerGesture | null = null;
  private inNudgeTransaction = false;
  private heldNudgeKeys = new Set<NudgeDirection>();

  override cursor(state: ToolCursorState): CursorSpec {
    return state === 'drag' ? { css: 'move' } : { css: 'crosshair' };
  }

  override onDeactivate(ctx: ToolContext): void {
    this.cancelPointerGesture(ctx);
    this.finishNudgeGesture(ctx);
    ctx.setNodeEditTargetId(null);
    this.selectedAnchors.clear();
    ctx.setNodeEditSelectedAnchors(new Set());
  }

  override onFocusLoss(ctx: ToolContext): void {
    this.cancelPointerGesture(ctx);
    this.finishNudgeGesture(ctx);
  }

  private finishNudgeGesture(ctx: ToolContext): void {
    this.heldNudgeKeys.clear();
    if (this.inNudgeTransaction) {
      ctx.commitTransaction();
      this.inNudgeTransaction = false;
    }
  }

  private beginNudgeTransaction(ctx: ToolContext): void {
    if (!this.inNudgeTransaction) {
      ctx.beginTransaction();
      this.inNudgeTransaction = true;
    }
  }

  private beginPointerTransaction(ctx: ToolContext): void {
    if (!this.pointerGesture || this.pointerGesture.active) return;
    ctx.beginTransaction();
    this.pointerGesture.active = true;
  }

  private cancelPointerGesture(ctx: ToolContext): void {
    const gesture = this.pointerGesture;
    if (!gesture) return;
    if (gesture.active) ctx.abortTransaction();
    ctx.releasePointerCapture(gesture.pointerId);
    this.pointerGesture = null;
    this.drag = idleDrag();
  }

  private finishPointerGesture(ctx: ToolContext): void {
    const gesture = this.pointerGesture;
    if (!gesture) return;
    if (gesture.active) ctx.commitTransaction();
    ctx.releasePointerCapture(gesture.pointerId);
    this.pointerGesture = null;
    this.drag = idleDrag();
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (this.pointerGesture) return { consumed: false };
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return { consumed: false };
    const target = pathNode(ctx, targetId);
    if (!target) return { consumed: false };

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return { consumed: false };
    const worldTransform =
      ctx.getWorldTransform?.(targetId) ?? nodeWorldTransform(ctx.document, targetId);
    const inverseWorld = safeInverse(worldTransform);
    if (!inverseWorld) {
      ctx.announce('This path cannot be edited because its transform is not invertible.');
      return { consumed: true };
    }
    const screen = pointerScreen(ctx, e);
    const hit = findNodeEditHit(
      pathRings(target.shape),
      target.shape.closed,
      worldTransform,
      screen,
      (point) => ctx.worldToCanvas(point.x, point.y),
    );
    if (!hit) {
      if (!e.shiftKey && !(e.pointerType === 'touch' && ctx.touchMultiSelect.active)) {
        this.selectedAnchors.clear();
        ctx.setNodeEditSelectedAnchors(new Set());
      }
      return { consumed: true };
    }

    const baseShape = clonePathShape(target.shape);
    const localStart = applyAffine(inverseWorld, [world.x, world.y]);
    if (!localStart.every(Number.isFinite)) return { consumed: true };
    const additive =
      e.shiftKey ||
      (e.pointerType === 'touch' && ctx.touchMultiSelect.active && !ctx.touchMultiSelect.suspended);

    let selected = new Set(this.selectedAnchors);
    if (hit.kind === 'anchor') {
      if (additive) {
        if (selected.has(hit.anchorIdx)) selected.delete(hit.anchorIdx);
        else selected.add(hit.anchorIdx);
        this.selectedAnchors = selected;
        ctx.setNodeEditSelectedAnchors(new Set(selected));
        if (!selected.has(hit.anchorIdx)) return { consumed: true };
      } else if (!selected.has(hit.anchorIdx)) {
        selected = new Set([hit.anchorIdx]);
        this.selectedAnchors = selected;
        ctx.setNodeEditSelectedAnchors(new Set(selected));
      }
    } else if (hit.kind === 'handle') {
      selected = additive ? new Set([...selected, hit.anchorIdx]) : new Set([hit.anchorIdx]);
      this.selectedAnchors = selected;
      ctx.setNodeEditSelectedAnchors(new Set(selected));
    }

    const gesture = this.makePointerGesture(
      hit,
      targetId,
      baseShape,
      selected,
      e.pointerId,
      world,
      [localStart[0], localStart[1]],
      inverseWorld,
      screen,
    );
    if (!gesture) return { consumed: true };
    this.pointerGesture = gesture;
    this.drag = {
      kind: 'dragging',
      pointerId: e.pointerId,
      startCanvas: screen,
      startWorld: world,
      currentCanvas: screen,
      currentWorld: world,
    };
    ctx.setPointerCapture(e.pointerId);
    return { consumed: true, captured: true };
  }

  private makePointerGesture(
    hit: NodeEditHit,
    targetId: string,
    baseShape: PathShape,
    selected: Set<number>,
    pointerId: number,
    startWorld: { x: number; y: number },
    startLocal: [number, number],
    inverseWorld: Affine,
    startCanvas: { x: number; y: number },
  ): PointerGesture | null {
    const base: PointerGestureBase = {
      pointerId,
      targetId,
      baseShape,
      selected: new Set(selected),
      startWorld,
      startLocal,
      inverseWorld,
      startCanvas,
      active: false,
    };
    if (hit.kind === 'anchor') return { ...base, kind: 'anchor', anchorIdx: hit.anchorIdx };
    if (hit.kind === 'segment') {
      return {
        ...base,
        kind: 'segment',
        ringIndex: hit.ringIndex,
        segmentIndex: hit.segmentIndex,
      };
    }
    const point = pathPointAtIndex(pathRings(baseShape), hit.anchorIdx);
    if (!point) return null;
    const startHandle = hit.which === 'in' ? point.handleIn : point.handleOut;
    if (!startHandle) return null;
    return {
      ...base,
      kind: 'handle',
      anchorIdx: hit.anchorIdx,
      which: hit.which,
      startHandle: [...startHandle] as [number, number],
      startMode: nodeModeForPoint(point),
    };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    const gesture = this.pointerGesture;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    if (ctx.nodeEditTargetId !== gesture.targetId || !pathNode(ctx, gesture.targetId)) {
      this.cancelPointerGesture(ctx);
      return;
    }
    const screen = pointerScreen(ctx, e);
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.drag.currentCanvas = screen;
    this.drag.currentWorld = world;
    if (screenDistance(screen, gesture.startCanvas) < DRAG_THRESHOLD_CSS_PX) return;
    const delta = localDelta(gesture.inverseWorld, gesture.startWorld, world);
    if (!delta) {
      this.cancelPointerGesture(ctx);
      return;
    }
    this.beginPointerTransaction(ctx);
    const nextShape = this.shapeForGesture(gesture, delta, e.altKey);
    if (!nextShape || !areFinitePathRings(pathRings(nextShape))) {
      this.cancelPointerGesture(ctx);
      return;
    }
    ctx.updateNode(gesture.targetId, (node) => {
      if (node.kind !== 'shape' || node.shape.kind !== 'path') return node;
      return { ...node, shape: nextShape } as ShapeNode;
    });
  }

  private shapeForGesture(
    gesture: PointerGesture,
    delta: [number, number],
    altKey: boolean,
  ): PathShape | null {
    if (gesture.kind === 'anchor') {
      return translateSelectedAnchors(gesture.baseShape, gesture.selected, delta);
    }
    if (gesture.kind === 'segment') {
      return bendPathSegment(gesture.baseShape, gesture.ringIndex, gesture.segmentIndex, delta);
    }
    return updatePointAtHandle(
      gesture.baseShape,
      gesture.anchorIdx,
      gesture.which,
      gesture.startHandle,
      delta,
      gesture.startMode,
      altKey,
    );
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (!this.pointerGesture || this.pointerGesture.pointerId !== e.pointerId) return;
    this.finishPointerGesture(ctx);
  }

  override onPointerCancel(e: PointerEvent, ctx: ToolContext): void {
    if (!this.pointerGesture || this.pointerGesture.pointerId !== e.pointerId) return;
    this.cancelPointerGesture(ctx);
  }

  override onDoubleClick(e: PointerEvent, ctx: ToolContext): void {
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return;
    const target = pathNode(ctx, targetId);
    if (!target) return;
    const dependency = findPathTopologyDependency(ctx.document, targetId);
    if (dependency) {
      ctx.announce(pathTopologyBlockMessage(dependency));
      return;
    }
    const worldTransform =
      ctx.getWorldTransform?.(targetId) ?? nodeWorldTransform(ctx.document, targetId);
    if (!safeInverse(worldTransform)) return;
    const hit = findNodeEditHit(
      pathRings(target.shape),
      target.shape.closed,
      worldTransform,
      pointerScreen(ctx, e),
      (point) => ctx.worldToCanvas(point.x, point.y),
    );
    if (hit?.kind !== 'segment') return;
    const inserted = insertPointOnPath(target.shape, hit.ringIndex, hit.segmentIndex, hit.t);
    if (!inserted) return;
    ctx.beginTransaction();
    ctx.updateNode(targetId, (node) => {
      if (node.kind !== 'shape' || node.shape.kind !== 'path') return node;
      return { ...node, shape: inserted.shape } as ShapeNode;
    });
    ctx.commitTransaction();
    const nextSelection = remapSelectionAfterInsertion(
      this.selectedAnchors,
      inserted.insertedIndex,
    );
    nextSelection.add(inserted.insertedIndex);
    this.selectedAnchors = nextSelection;
    ctx.setNodeEditSelectedAnchors(new Set(nextSelection));
    ctx.announce(`Inserted node ${inserted.insertedIndex + 1}.`);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      if (this.pointerGesture) {
        this.cancelPointerGesture(ctx);
        return true;
      }
      this.finishNudgeGesture(ctx);
      ctx.setTool('select');
      return true;
    }
    if (e.key === 'v' || e.key === 'V') {
      this.cancelPointerGesture(ctx);
      this.finishNudgeGesture(ctx);
      ctx.setTool('select');
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') return this.deleteSelectedAnchors(ctx);
    if (e.shiftKey && e.key.toLowerCase() === 'c') return this.applyMode('corner', ctx);
    if (e.shiftKey && e.key.toLowerCase() === 's') return this.applyMode('smooth', ctx);
    if (e.shiftKey && e.key.toLowerCase() === 'y') return this.applyMode('symmetric', ctx);
    if (e.shiftKey && e.key.toLowerCase() === 'a') return this.applyMode('automatic', ctx);
    if (e.key === 'c' || e.key === 'C') return this.toggleCornerSmooth(ctx);

    const direction = nudgeDirectionForKey(e.key);
    if (!direction) return false;
    if (e.altKey || e.ctrlKey || e.metaKey) {
      this.finishNudgeGesture(ctx);
      return false;
    }
    return this.nudgeSelectedAnchors(direction, e.shiftKey ? 'large' : 'standard', ctx);
  }

  override onKeyUp(e: KeyboardEvent, ctx: ToolContext): void {
    const direction = nudgeDirectionForKey(e.key);
    if (direction && this.heldNudgeKeys.delete(direction) && this.heldNudgeKeys.size === 0) {
      this.finishNudgeGesture(ctx);
    }
  }

  private nudgeSelectedAnchors(
    direction: NudgeDirection,
    mode: 'standard' | 'large',
    ctx: ToolContext,
  ): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;
    const target = pathNode(ctx, targetId);
    if (!target) return false;
    const inverseWorld = safeInverse(
      ctx.getWorldTransform?.(targetId) ?? nodeWorldTransform(ctx.document, targetId),
    );
    if (!inverseWorld) return false;
    const world = nudgeDelta(direction, getNudgeStep(mode, loadSettings().nudge));
    const delta: [number, number] = [
      inverseWorld[0] * world.x + inverseWorld[2] * world.y,
      inverseWorld[1] * world.x + inverseWorld[3] * world.y,
    ];
    if (!delta.every(Number.isFinite)) return false;
    if (this.heldNudgeKeys.size === 0) this.beginNudgeTransaction(ctx);
    this.heldNudgeKeys.add(direction);
    const selected = new Set(this.selectedAnchors);
    ctx.updateNode(targetId, (node) => {
      if (node.kind !== 'shape' || node.shape.kind !== 'path') return node;
      return {
        ...node,
        shape: translateSelectedAnchors(node.shape, selected, delta),
      } as ShapeNode;
    });
    return true;
  }

  private deleteSelectedAnchors(ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;
    const target = pathNode(ctx, targetId);
    if (!target) return false;
    const dependency = findPathTopologyDependency(ctx.document, targetId);
    if (dependency) {
      ctx.announce(pathTopologyBlockMessage(dependency));
      return true;
    }
    const result = deleteSelectedAnchorsFromPath(target.shape, this.selectedAnchors);
    if (!result) {
      ctx.announce('The selected nodes cannot be deleted without invalidating the contour.');
      return true;
    }
    ctx.beginTransaction();
    ctx.updateNode(targetId, (node) => {
      if (node.kind !== 'shape' || node.shape.kind !== 'path') return node;
      return { ...node, shape: result.shape } as ShapeNode;
    });
    ctx.commitTransaction();
    this.selectedAnchors = result.selection;
    ctx.setNodeEditSelectedAnchors(new Set(result.selection));
    return true;
  }

  private applyMode(mode: PathNodeMode, ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;
    const target = pathNode(ctx, targetId);
    if (!target) return false;
    let shape = target.shape;
    for (const index of this.selectedAnchors) shape = setNodeModeAtIndex(shape, index, mode);
    if (!areFinitePathRings(pathRings(shape))) return false;
    ctx.beginTransaction();
    ctx.updateNode(targetId, (node) => {
      if (node.kind !== 'shape' || node.shape.kind !== 'path') return node;
      return { ...node, shape } as ShapeNode;
    });
    ctx.commitTransaction();
    return true;
  }

  private toggleCornerSmooth(ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;
    const target = pathNode(ctx, targetId);
    if (!target) return false;
    let shape = target.shape;
    for (const index of this.selectedAnchors) {
      const point = pathPointAtIndex(pathRings(shape), index);
      if (!point) continue;
      const mode = nodeModeForPoint(point) === 'corner' ? 'smooth' : 'corner';
      shape = setNodeModeAtIndex(shape, index, mode);
    }
    ctx.beginTransaction();
    ctx.updateNode(targetId, (node) => {
      if (node.kind !== 'shape' || node.shape.kind !== 'path') return node;
      return { ...node, shape } as ShapeNode;
    });
    ctx.commitTransaction();
    return true;
  }

  /** Returns current selected anchor indices (for overlay rendering). */
  getSelectedAnchors(): ReadonlySet<number> {
    return this.selectedAnchors;
  }
}

function updatePointAtHandle(
  shape: PathShape,
  anchorIdx: number,
  which: 'in' | 'out',
  startHandle: readonly [number, number],
  delta: readonly [number, number],
  startMode: PathNodeMode,
  altKey: boolean,
): PathShape {
  const rings = pathRings(shape);
  const location = locatePathIndex(rings, anchorIdx);
  if (!location) return shape;
  const ring = rings[location.ringIndex]!;
  const point = ring[location.pointIndex]!;
  ring[location.pointIndex] = moveHandle(point, which, startHandle, delta, startMode, altKey);
  return withPathRings(shape, rings);
}
