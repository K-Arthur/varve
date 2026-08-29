/**
 * Authoritative manual alignment and distribution operations.
 *
 * Bounds and alignment targets are evaluated in placed world space. Each
 * resulting translation is then converted back to the selected node's direct
 * parent space, preserving hierarchy, rotation, scale, flips, and local
 * geometry. This is shared by every editor surface through EditorContext.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { buildParentIndexMap } from '@varve/scene';
import {
  type Affine,
  type AlignAxis,
  type AlignmentTarget,
  alignBBox,
  applyAffine,
  type BBox,
  computeAlignmentTarget,
  computeDistribution,
  computeDistributionCenters,
  type DistributeAxis,
  type DistributeMode,
  type OBB,
  obbAlignmentTarget,
  tryInvertAffine,
} from '@varve/shared';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from './world';

const POSITION_EPSILON = 1e-9;

export interface AlignmentCapabilities {
  rootCount: number;
  movableRootCount: number;
  canAlign: boolean;
  canDistribute: boolean;
  hasLockedOrHiddenSelection: boolean;
  hasLayoutManagedSelection: boolean;
}

export interface AlignSelectionOptions {
  /** A selected, independently movable key object remains stationary. */
  keyObjectId?: NodeId | null;
  /** Explicit page/canvas bounds take precedence over collective selection bounds. */
  pageBounds?: BBox | null;
}

export interface DistributeSelectionOptions {
  mode?: DistributeMode;
  /** An explicit edge gap. A negative gap intentionally overlaps items. */
  gap?: number;
}

interface SelectionItem {
  id: NodeId;
  node: SceneNode;
  bounds: BBox;
  parentId: NodeId | null;
}

interface CollectedSelection {
  items: SelectionItem[];
  parentIndex: Map<NodeId, NodeId>;
  rootCount: number;
  hasLockedOrHiddenSelection: boolean;
  hasLayoutManagedSelection: boolean;
}

/**
 * Shared capability predicate for toolbar-style alignment controls.
 *
 * Manual commands never move a flow-managed auto-layout child: its parent
 * owns that position and would immediately reflow it. Absolute children of a
 * layout frame remain manually positionable.
 */
export function getAlignmentCapabilities(
  doc: Document,
  selection: readonly NodeId[],
): AlignmentCapabilities {
  const collected = collectSelection(doc, selection);
  return {
    rootCount: collected.rootCount,
    movableRootCount: collected.items.length,
    canAlign: collected.items.length >= 2,
    canDistribute: collected.items.length >= 3,
    hasLockedOrHiddenSelection: collected.hasLockedOrHiddenSelection,
    hasLayoutManagedSelection: collected.hasLayoutManagedSelection,
  };
}

/** Align independently movable selection roots using transformed world bounds. */
export function alignSelectionInDocument(
  doc: Document,
  selection: readonly NodeId[],
  axis: AlignAxis,
  options: AlignSelectionOptions = {},
): Document {
  const collected = collectSelection(doc, selection);
  const { items } = collected;
  if (items.length < 2) return doc;

  const target = resolveAlignmentTarget(items, axis, options);
  if (!target) return doc;

  const deltas = items.map((item) => {
    const position = alignBBox(item.bounds, axis, target);
    return { id: item.id, x: position.x - item.bounds.x, y: position.y - item.bounds.y };
  });
  return applyWorldTranslations(doc, items, collected.parentIndex, deltas);
}

/** Distribute independently movable selection roots in transformed world space. */
export function distributeSelectionInDocument(
  doc: Document,
  selection: readonly NodeId[],
  axis: DistributeAxis,
  options: DistributeSelectionOptions = {},
): Document {
  const collected = collectSelection(doc, selection);
  const { items } = collected;
  if (items.length < 3) return doc;

  const mode = options.mode ?? 'equalGap';
  const sorted = [...items].sort((a, b) => compareItems(axis, mode, a, b));
  const bounds = sorted.map((item) => item.bounds);
  const positions =
    mode === 'equalCenter'
      ? computeDistributionCenters(axis, bounds)
      : computeDistribution(axis, bounds, finiteGap(options.gap));
  if (!positions) return doc;

  const deltas = sorted.map((item, index) => {
    const position = positions[index];
    if (position === undefined || !Number.isFinite(position)) return { id: item.id, x: 0, y: 0 };
    const targetEdge =
      mode === 'equalCenter'
        ? position - (axis === 'horizontal' ? item.bounds.w : item.bounds.h) / 2
        : position;
    return axis === 'horizontal'
      ? { id: item.id, x: targetEdge - item.bounds.x, y: 0 }
      : { id: item.id, x: 0, y: targetEdge - item.bounds.y };
  });
  return applyWorldTranslations(doc, items, collected.parentIndex, deltas);
}

/**
 * Optional oriented-bounds alignment for the inspector's explicit OBB mode.
 * The default alignment command intentionally uses transformed AABBs, which
 * is the conventional design-tool selection-bounds behavior.
 */
export function alignSelectionWithObbInDocument(
  doc: Document,
  selection: readonly NodeId[],
  axis: AlignAxis,
  options: AlignSelectionOptions = {},
): Document {
  const collected = collectSelection(doc, selection);
  const items = collected.items.flatMap((item) => {
    const local = nodeLocalBounds(item.node, doc);
    if (!local) return [];
    const transform = nodeWorldTransform(doc, item.id, collected.parentIndex);
    if (!isFiniteAffine(transform)) return [];
    return [{ ...item, obb: transformedRectCorners(transform, local) }];
  });
  if (items.length < 2) return doc;

  const target = resolveObbTarget(items, axis, options);
  if (target === null) return doc;
  const deltas = items.map((item) => {
    const current = obbAlignmentTarget(axis, [item.obb]);
    if (current === null || !Number.isFinite(current)) return { id: item.id, x: 0, y: 0 };
    const difference = target - current;
    return axis === 'left' || axis === 'centerH' || axis === 'right'
      ? { id: item.id, x: difference, y: 0 }
      : { id: item.id, x: 0, y: difference };
  });
  return applyWorldTranslations(doc, items, collected.parentIndex, deltas);
}

function collectSelection(doc: Document, selection: readonly NodeId[]): CollectedSelection {
  const parentIndex = buildParentIndexMap(doc);
  const requested = new Set(selection.filter((id) => doc.nodes[id] !== undefined));
  const roots = [...requested].filter((id) => !hasSelectedAncestor(id, requested, parentIndex));
  const items: SelectionItem[] = [];
  let hasLockedOrHiddenSelection = false;
  let hasLayoutManagedSelection = false;

  for (const id of roots) {
    const node = doc.nodes[id];
    if (!node) continue;
    const parentId = parentIndex.get(id) ?? null;
    const eligibility = manualPositionEligibility(doc, id, parentId, parentIndex);
    if (eligibility === 'locked-or-hidden') {
      hasLockedOrHiddenSelection = true;
      continue;
    }
    if (eligibility === 'layout-managed') {
      hasLayoutManagedSelection = true;
      continue;
    }
    if (eligibility !== 'eligible') continue;

    const bounds = nodeWorldBounds(doc, id, parentIndex);
    if (!isFiniteBounds(bounds)) continue;
    items.push({ id, node, bounds, parentId });
  }

  return {
    items,
    parentIndex,
    rootCount: roots.length,
    hasLockedOrHiddenSelection,
    hasLayoutManagedSelection,
  };
}

function manualPositionEligibility(
  doc: Document,
  id: NodeId,
  parentId: NodeId | null,
  parentIndex: Map<NodeId, NodeId>,
): 'eligible' | 'locked-or-hidden' | 'layout-managed' | 'invalid-transform' {
  const visited = new Set<NodeId>();
  let current: NodeId | undefined = id;
  while (current && !visited.has(current)) {
    visited.add(current);
    const node = doc.nodes[current];
    if (!node || node.locked || node.visible === false) return 'locked-or-hidden';
    current = parentIndex.get(current);
  }

  const node = doc.nodes[id];
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (parent?.kind === 'frame' && parent.layoutStyle && node?.layoutPosition !== 'absolute') {
    return 'layout-managed';
  }
  if (!node || !isFiniteAffine(node.transform)) return 'invalid-transform';
  if (parentId && !tryInvertAffine(nodeWorldTransform(doc, parentId, parentIndex))) {
    return 'invalid-transform';
  }
  return 'eligible';
}

function resolveAlignmentTarget(
  items: readonly SelectionItem[],
  axis: AlignAxis,
  options: AlignSelectionOptions,
): AlignmentTarget | null {
  const keyItem = options.keyObjectId
    ? items.find((item) => item.id === options.keyObjectId)
    : null;
  if (keyItem) return targetForBounds(keyItem.bounds);
  if (isFiniteBounds(options.pageBounds)) return targetForBounds(options.pageBounds);
  return computeAlignmentTarget(
    axis,
    items.map((item) => item.bounds),
  );
}

function resolveObbTarget(
  items: ReadonlyArray<SelectionItem & { obb: OBB }>,
  axis: AlignAxis,
  options: AlignSelectionOptions,
): number | null {
  const keyItem = options.keyObjectId
    ? items.find((item) => item.id === options.keyObjectId)
    : null;
  if (keyItem) return obbAlignmentTarget(axis, [keyItem.obb]);
  if (isFiniteBounds(options.pageBounds))
    return alignmentTargetCoordinate(axis, options.pageBounds);
  return obbAlignmentTarget(
    axis,
    items.map((item) => item.obb),
  );
}

function applyWorldTranslations(
  doc: Document,
  items: readonly SelectionItem[],
  parentIndex: Map<NodeId, NodeId>,
  deltas: ReadonlyArray<{ id: NodeId; x: number; y: number }>,
): Document {
  const itemById = new Map(items.map((item) => [item.id, item]));
  let nodes: Document['nodes'] | null = null;

  for (const delta of deltas) {
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) continue;
    if (Math.abs(delta.x) <= POSITION_EPSILON && Math.abs(delta.y) <= POSITION_EPSILON) continue;
    const item = itemById.get(delta.id);
    if (!item) continue;
    const transform = translatedLocalTransform(doc, item, parentIndex, delta.x, delta.y);
    if (!transform) continue;
    nodes ??= { ...doc.nodes };
    nodes[item.id] = { ...item.node, transform } as SceneNode;
  }

  return nodes ? { ...doc, nodes } : doc;
}

function translatedLocalTransform(
  doc: Document,
  item: SelectionItem,
  parentIndex: Map<NodeId, NodeId>,
  deltaX: number,
  deltaY: number,
): Affine | null {
  const current = item.node.transform as Affine;
  if (!isFiniteAffine(current)) return null;

  if (!item.parentId) {
    const x = current[4] + deltaX;
    const y = current[5] + deltaY;
    return Number.isFinite(x) && Number.isFinite(y)
      ? [current[0], current[1], current[2], current[3], x, y]
      : null;
  }

  const parentWorld = nodeWorldTransform(doc, item.parentId, parentIndex);
  const parentInverse = tryInvertAffine(parentWorld);
  const worldTransform = nodeWorldTransform(doc, item.id, parentIndex);
  if (!parentInverse || !isFiniteAffine(worldTransform)) return null;

  const targetLocal = applyAffine(parentInverse, [
    worldTransform[4] + deltaX,
    worldTransform[5] + deltaY,
  ]);
  if (!Number.isFinite(targetLocal[0]) || !Number.isFinite(targetLocal[1])) return null;
  return [current[0], current[1], current[2], current[3], targetLocal[0], targetLocal[1]];
}

function compareItems(
  axis: DistributeAxis,
  mode: DistributeMode,
  a: SelectionItem,
  b: SelectionItem,
): number {
  const aPrimary =
    axis === 'horizontal'
      ? a.bounds.x + (mode === 'equalCenter' ? a.bounds.w / 2 : 0)
      : a.bounds.y + (mode === 'equalCenter' ? a.bounds.h / 2 : 0);
  const bPrimary =
    axis === 'horizontal'
      ? b.bounds.x + (mode === 'equalCenter' ? b.bounds.w / 2 : 0)
      : b.bounds.y + (mode === 'equalCenter' ? b.bounds.h / 2 : 0);
  if (aPrimary !== bPrimary) return aPrimary - bPrimary;
  const aSecondary = axis === 'horizontal' ? a.bounds.y : a.bounds.x;
  const bSecondary = axis === 'horizontal' ? b.bounds.y : b.bounds.x;
  if (aSecondary !== bSecondary) return aSecondary - bSecondary;
  return a.id.localeCompare(b.id);
}

function finiteGap(gap: number | undefined): number | undefined {
  return gap === undefined || Number.isFinite(gap) ? gap : undefined;
}

function targetForBounds(bounds: BBox): AlignmentTarget {
  return {
    left: bounds.x,
    right: bounds.x + bounds.w,
    top: bounds.y,
    bottom: bounds.y + bounds.h,
    centerX: bounds.x + bounds.w / 2,
    centerY: bounds.y + bounds.h / 2,
  };
}

function alignmentTargetCoordinate(axis: AlignAxis, bounds: BBox): number {
  switch (axis) {
    case 'left':
      return bounds.x;
    case 'centerH':
      return bounds.x + bounds.w / 2;
    case 'right':
      return bounds.x + bounds.w;
    case 'top':
      return bounds.y;
    case 'centerV':
      return bounds.y + bounds.h / 2;
    case 'bottom':
      return bounds.y + bounds.h;
  }
}

function transformedRectCorners(transform: Affine, bounds: BBox): OBB {
  return [
    applyAffine(transform, [bounds.x, bounds.y]),
    applyAffine(transform, [bounds.x + bounds.w, bounds.y]),
    applyAffine(transform, [bounds.x + bounds.w, bounds.y + bounds.h]),
    applyAffine(transform, [bounds.x, bounds.y + bounds.h]),
  ];
}

function hasSelectedAncestor(
  id: NodeId,
  selected: ReadonlySet<NodeId>,
  parentIndex: ReadonlyMap<NodeId, NodeId>,
): boolean {
  const visited = new Set<NodeId>([id]);
  let parentId = parentIndex.get(id);
  while (parentId && !visited.has(parentId)) {
    if (selected.has(parentId)) return true;
    visited.add(parentId);
    parentId = parentIndex.get(parentId);
  }
  return false;
}

function isFiniteBounds(bounds: BBox | null | undefined): bounds is BBox {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.x) &&
      Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.w) &&
      Number.isFinite(bounds.h) &&
      bounds.w >= 0 &&
      bounds.h >= 0,
  );
}

function isFiniteAffine(transform: readonly number[]): transform is Affine {
  return transform.length === 6 && transform.every(Number.isFinite);
}
