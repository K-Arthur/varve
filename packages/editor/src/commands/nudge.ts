import { buildParentIndexMap, type Document, type NodeId, type SceneNode } from '@varve/scene';
import { type Affine, tryInvertAffine } from '@varve/shared';
import { planManualWorldTranslation } from '../scene/selectionArrangement';
import { nodeWorldTransform } from '../scene/world';

export type NudgeDirection = 'up' | 'down' | 'left' | 'right';
export type NudgeMode = 'standard' | 'large' | 'fine';

export interface NudgeContext {
  document: Document;
  selection: NodeId[];
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  /**
   * Batch setter: when present, all roots are applied in one document update
   * instead of spreading the nodes map once per selected item.
   */
  setNodePositions?: (positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>) => void;
}

export interface NudgeResult {
  moved: number;
  locked: number;
  skipped: number;
  total: number;
}

/** A pure, hierarchy-safe nudge ready for one mutation. */
export interface NudgePlan extends NudgeResult {
  positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>;
}

interface NudgeGestureRoot {
  id: NodeId;
  parentId: NodeId | null;
  parentInverse: Affine | null;
  kind: SceneNode['kind'];
  locked: boolean;
  visible: boolean | undefined;
  layoutPosition: SceneNode['layoutPosition'];
  rotation: number | undefined;
  linearTransform: readonly [number, number, number, number];
  expectedX: number;
  expectedY: number;
}

/**
 * A validated snapshot for one held-key gesture. It is deliberately scoped
 * to the interaction: document topology or ancestor changes invalidate it
 * and fall back to the canonical full planner on that same key event.
 */
export interface NudgeGestureSession {
  readonly selection: readonly NodeId[];
  readonly pages: Document['pages'];
  readonly rootChildren: Document['rootChildren'];
  readonly stableNodes: ReadonlyArray<{ id: NodeId; node: SceneNode }>;
  readonly roots: NudgeGestureRoot[];
  readonly locked: number;
  readonly skipped: number;
  readonly total: number;
}

const NUDGE_STEPS: Record<NudgeMode, number> = {
  standard: 1,
  large: 10,
  fine: 0.5,
};

export function getNudgeStep(mode: NudgeMode): number {
  return NUDGE_STEPS[mode];
}

export function canNudge(selection: NodeId[]): boolean {
  return selection.length > 0;
}

export function getNudgeDisabledReason(selection: NodeId[]): string | null {
  if (selection.length === 0) return 'No selection';
  return null;
}

/**
 * Plan a document-space nudge without mutating the document. Every eligible
 * transform root receives the same placed-world delta; the shared arrangement
 * resolver converts it through any transformed parent back into local space.
 */
export function planNudge(
  direction: NudgeDirection,
  step: number,
  document: Document,
  selection: readonly NodeId[],
): NudgePlan {
  const { x, y } = nudgeDelta(direction, step);
  const plan = planManualWorldTranslation(document, selection, { x, y });
  return {
    positions: plan.positions,
    moved: plan.positions.length,
    locked: plan.locked,
    skipped: plan.skipped,
    total: selection.length,
  };
}

/**
 * Capture the invariant parent-space conversion after the first successful
 * key event in a held gesture. Later repeat events use this only while every
 * hierarchy and transform witness still matches; otherwise callers fall back
 * to {@link planNudge} without compromising correctness.
 */
export function createNudgeGestureSession(
  document: Document,
  selection: readonly NodeId[],
  plan: NudgePlan,
): NudgeGestureSession | null {
  if (plan.positions.length === 0) return null;

  const parentIndex = buildParentIndexMap(document);
  const rootIds = new Set(plan.positions.map((position) => position.id));
  const stableNodes = new Map<NodeId, SceneNode>();
  const roots: NudgeGestureRoot[] = [];

  for (const id of selection) {
    const node = document.nodes[id];
    if (!node) return null;
    if (!rootIds.has(id)) stableNodes.set(id, node);

    const visited = new Set<NodeId>([id]);
    let ancestorId = parentIndex.get(id);
    while (ancestorId) {
      if (visited.has(ancestorId)) return null;
      visited.add(ancestorId);
      const ancestor = document.nodes[ancestorId];
      if (!ancestor) return null;
      if (!rootIds.has(ancestorId)) stableNodes.set(ancestorId, ancestor);
      ancestorId = parentIndex.get(ancestorId);
    }
  }

  for (const position of plan.positions) {
    const node = document.nodes[position.id];
    if (!node || !isFiniteAffine(node.transform)) return null;
    const parentId = parentIndex.get(position.id) ?? null;
    const parentInverse = parentId
      ? tryInvertAffine(nodeWorldTransform(document, parentId, parentIndex))
      : null;
    if (parentId && (!parentInverse || !isFiniteAffine(parentInverse))) return null;
    roots.push({
      id: position.id,
      parentId,
      parentInverse,
      kind: node.kind,
      locked: node.locked,
      visible: node.visible,
      layoutPosition: node.layoutPosition,
      rotation: node.rotation,
      linearTransform: [node.transform[0], node.transform[1], node.transform[2], node.transform[3]],
      expectedX: position.x,
      expectedY: position.y,
    });
  }

  return {
    selection: [...selection],
    pages: document.pages,
    rootChildren: document.rootChildren,
    stableNodes: [...stableNodes].map(([id, node]) => ({ id, node })),
    roots,
    locked: plan.locked,
    skipped: plan.skipped,
    total: plan.total,
  };
}

/**
 * Plan the next event in a held-key gesture without rebuilding the document
 * parent index. A null result means a state witness changed, so the caller
 * must use the authoritative full planner for this event instead.
 */
export function planNudgeRepeat(
  session: NudgeGestureSession,
  direction: NudgeDirection,
  step: number,
  document: Document,
  selection: readonly NodeId[],
): NudgePlan | null {
  if (!sameNodeIdList(session.selection, selection)) return null;
  if (document.pages !== session.pages || document.rootChildren !== session.rootChildren)
    return null;
  for (const stable of session.stableNodes) {
    if (document.nodes[stable.id] !== stable.node) return null;
  }

  const delta = nudgeDelta(direction, step);
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return null;
  const positions: Array<{ id: NodeId; x: number; y: number }> = [];

  for (const root of session.roots) {
    const node = document.nodes[root.id];
    if (!node || !matchesNudgeGestureRoot(node, root)) return null;
    if (
      Math.abs(node.transform[4] - root.expectedX) > POSITION_EPSILON ||
      Math.abs(node.transform[5] - root.expectedY) > POSITION_EPSILON
    ) {
      return null;
    }
    const localDelta = root.parentInverse
      ? {
          x: root.parentInverse[0] * delta.x + root.parentInverse[2] * delta.y,
          y: root.parentInverse[1] * delta.x + root.parentInverse[3] * delta.y,
        }
      : delta;
    const x = node.transform[4] + localDelta.x;
    const y = node.transform[5] + localDelta.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (
      Math.abs(x - node.transform[4]) <= POSITION_EPSILON &&
      Math.abs(y - node.transform[5]) <= POSITION_EPSILON
    ) {
      return null;
    }
    positions.push({ id: root.id, x, y });
  }

  for (let index = 0; index < session.roots.length; index += 1) {
    const root = session.roots[index];
    const position = positions[index];
    if (!root || !position) return null;
    root.expectedX = position.x;
    root.expectedY = position.y;
  }

  return {
    positions,
    moved: positions.length,
    locked: session.locked,
    skipped: session.skipped,
    total: session.total,
  };
}

/** Apply a previously-planned nudge through the caller's mutation facade. */
export function applyNudgePlan(
  plan: NudgePlan,
  ctx: Pick<NudgeContext, 'setNodePosition' | 'setNodePositions'>,
): NudgeResult {
  if (plan.positions.length > 0 && ctx.setNodePositions) {
    ctx.setNodePositions(plan.positions);
  } else {
    for (const position of plan.positions) {
      ctx.setNodePosition(position.id, position.x, position.y);
    }
  }
  return {
    moved: plan.moved,
    locked: plan.locked,
    skipped: plan.skipped,
    total: plan.total,
  };
}

export function executeNudge(
  direction: NudgeDirection,
  step: number,
  ctx: NudgeContext,
): NudgeResult {
  return applyNudgePlan(planNudge(direction, step, ctx.document, ctx.selection), ctx);
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

const POSITION_EPSILON = 1e-9;

function isFiniteAffine(transform: readonly number[]): transform is Affine {
  return transform.length === 6 && transform.every(Number.isFinite);
}

function sameNodeIdList(a: readonly NodeId[], b: readonly NodeId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function matchesNudgeGestureRoot(node: SceneNode, root: NudgeGestureRoot): boolean {
  if (!isFiniteAffine(node.transform)) return false;
  if (
    node.kind !== root.kind ||
    node.locked !== root.locked ||
    node.visible !== root.visible ||
    node.layoutPosition !== root.layoutPosition ||
    !Object.is(node.rotation, root.rotation)
  ) {
    return false;
  }
  return root.linearTransform.every((value, index) => node.transform[index] === value);
}
