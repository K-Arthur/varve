/**
 * Authoritative manual alignment and distribution operations.
 *
 * Bounds and alignment targets are evaluated in placed world space. Each
 * resulting translation is then converted back to the selected node's direct
 * parent space, preserving hierarchy, rotation, scale, flips, and local
 * geometry. This is shared by every editor surface through EditorContext.
 */

import {
  buildParentIndexMap,
  type Document,
  type NodeId,
  pageBoundsInWorld,
  type SceneNode,
} from '@varve/scene';
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
  computeTidyLayout,
  type DistributeAxis,
  type DistributeMode,
  type OBB,
  obbAlignmentTarget,
  type TidyLayoutOptions,
  tryInvertAffine,
} from '@varve/shared';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from './world';

const POSITION_EPSILON = 1e-9;

export interface AlignmentCapabilities {
  rootCount: number;
  movableRootCount: number;
  /** Transform roots that survived hierarchy and manual-position eligibility. */
  eligibleRootIds: ReadonlyArray<NodeId>;
  /** Alignment against the collective selection or a key object. */
  canAlign: boolean;
  /** Alignment against explicit page/canvas bounds. */
  canAlignToPage: boolean;
  /** Alignment against the nearest common frame ancestor. */
  canAlignToContainer: boolean;
  canDistribute: boolean;
  /** Explicit numeric edge gaps have a deterministic two-item policy. */
  canSetGap: boolean;
  canTidy: boolean;
  hasLockedOrHiddenSelection: boolean;
  hasLayoutManagedSelection: boolean;
}

export interface AlignSelectionOptions {
  /** The explicit reference for this operation. Defaults to selection bounds. */
  reference?: AlignmentReference;
  /** A selected, independently movable key object remains stationary. */
  keyObjectId?: NodeId | null;
  /** Explicit page/canvas bounds take precedence over collective selection bounds. */
  pageBounds?: BBox | null;
  /** Bounds of the nearest common frame/container, when one exists. */
  containerBounds?: BBox | null;
}

export type AlignmentReference = 'selection' | 'container' | 'page';

export interface AlignmentGuideLine {
  axis: 'vertical' | 'horizontal';
  position: number;
  /** Human-readable description of the applied relationship. */
  label?: string;
}

export interface AlignmentFeedback {
  /** Guide geometry is derived from the post-command document. */
  lines: ReadonlyArray<AlignmentGuideLine>;
  /** Roots whose transforms changed in the applied command. */
  movedIds: ReadonlyArray<NodeId>;
  reference: AlignmentReference;
  keyObjectId: NodeId | null;
}

export interface DistributeSelectionOptions {
  mode?: DistributeMode;
  /** An explicit edge gap. A negative gap intentionally overlaps items. */
  gap?: number;
}

interface ManualPositionItem {
  id: NodeId;
  node: SceneNode;
  parentId: NodeId | null;
}

interface SelectionItem extends ManualPositionItem {
  bounds: BBox;
}

interface CollectedSelection {
  items: SelectionItem[];
  parentIndex: Map<NodeId, NodeId>;
  rootCount: number;
  hasLockedOrHiddenSelection: boolean;
  hasLayoutManagedSelection: boolean;
}

interface CollectedManualPositionRoots {
  items: ManualPositionItem[];
  eligibleRootIds: NodeId[];
  reparentableRootIds: NodeId[];
  parentIndex: Map<NodeId, NodeId>;
  rootCount: number;
  lockedCount: number;
  skippedCount: number;
  hasLockedOrHiddenSelection: boolean;
  hasLayoutManagedSelection: boolean;
}

/**
 * A hierarchy-safe, world-space translation ready for one batched document
 * mutation. `positions` intentionally contains only transform roots: when a
 * selected ancestor already carries a descendant, translating both would
 * move the descendant twice.
 */
export interface ManualWorldTranslationPlan {
  positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>;
  /** Eligible transform roots, including roots whose requested delta is zero. */
  eligibleRootIds: ReadonlyArray<NodeId>;
  /** Roots that may participate in pointer reparent/reorder decisions. */
  reparentableRootIds: ReadonlyArray<NodeId>;
  rootCount: number;
  locked: number;
  skipped: number;
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
  const containerBounds = commonAlignmentContainerBounds(doc, selection);
  return {
    rootCount: collected.rootCount,
    movableRootCount: collected.items.length,
    eligibleRootIds: collected.items.map((item) => item.id),
    canAlign: collected.items.length >= 2,
    canAlignToPage: collected.items.length >= 1,
    canAlignToContainer: collected.items.length >= 1 && containerBounds !== null,
    canDistribute: collected.items.length >= 3,
    canSetGap: collected.items.length >= 2,
    canTidy: collected.items.length >= 2,
    hasLockedOrHiddenSelection: collected.hasLockedOrHiddenSelection,
    hasLayoutManagedSelection: collected.hasLayoutManagedSelection,
  };
}

/**
 * Return the nearest common frame ancestor for the independently selected
 * roots. A selected frame itself is never its own target; the search starts
 * at its parent. This supports one child, siblings, and mixed-depth nested
 * selections while keeping the target in the same placed world space.
 */
export function commonAlignmentContainerBounds(
  doc: Document,
  selection: readonly NodeId[],
): BBox | null {
  const parentIndex = buildParentIndexMap(doc);
  const requested = new Set(selection.filter((id) => doc.nodes[id] !== undefined));
  const roots = [...requested].filter((id) => !hasSelectedAncestor(id, requested, parentIndex));
  const first = roots[0];
  if (!first) return null;

  let candidate = parentIndex.get(first) ?? null;
  while (candidate) {
    const node = doc.nodes[candidate];
    if (
      node?.kind === 'frame' &&
      roots.every((id) => isDescendantOf(id, candidate!, parentIndex))
    ) {
      const bounds = nodeWorldBounds(doc, candidate, parentIndex);
      if (isFiniteBounds(bounds)) return bounds;
    }
    candidate = parentIndex.get(candidate) ?? null;
  }
  return null;
}

/** Resolve the active placed page trim, with the legacy flat-canvas fallback. */
export function alignmentPageBounds(doc: Document): BBox {
  const placed = doc.activePageId ? pageBoundsInWorld(doc, doc.activePageId) : null;
  if (placed) return placed;
  const legacy = doc as Document & { canvasWidth?: number; canvasHeight?: number };
  return {
    x: 0,
    y: 0,
    w: legacy.canvasWidth ?? 1920,
    h: legacy.canvasHeight ?? 1080,
  };
}

/**
 * Resolve a document/world-space translation for independently movable
 * selection roots. It shares the same hierarchy/eligibility and
 * world-to-parent conversion policy as alignment and distribution, while
 * applying the same placed-world delta to every eligible root.
 *
 * Bounds are deliberately not consulted here. Empty groups and other
 * geometry-free transform containers are still valid translation roots.
 */
export function planManualWorldTranslation(
  doc: Document,
  selection: readonly NodeId[],
  delta: { x: number; y: number },
): ManualWorldTranslationPlan {
  const origins = new Map<NodeId, { x: number; y: number }>();
  const parentIndex = buildParentIndexMap(doc);
  for (const id of selection) {
    if (!doc.nodes[id]) continue;
    const world = nodeWorldTransform(doc, id, parentIndex);
    origins.set(id, { x: world[4], y: world[5] });
  }
  return planManualWorldTranslationFromOrigins(doc, selection, origins, delta);
}

/**
 * Plan a drag from the world-space origins captured at pointer-down. The
 * shared root/eligibility pass prevents selected descendants from moving twice
 * and keeps pointer movement aligned with keyboard and arrange operations.
 */
export function planManualWorldTranslationFromOrigins(
  doc: Document,
  selection: readonly NodeId[],
  origins: ReadonlyMap<NodeId, { x: number; y: number }>,
  delta: { x: number; y: number },
): ManualWorldTranslationPlan {
  const collected = collectManualPositionRoots(doc, selection);
  let skipped = collected.skippedCount;
  const positions: Array<{ id: NodeId; x: number; y: number }> = [];

  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return {
      positions,
      eligibleRootIds: collected.eligibleRootIds,
      reparentableRootIds: collected.reparentableRootIds,
      rootCount: collected.rootCount,
      locked: collected.lockedCount,
      skipped: skipped + collected.items.length,
    };
  }

  for (const item of collected.items) {
    const origin = origins.get(item.id);
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
      skipped++;
      continue;
    }
    const transform = translatedLocalTransformToWorldOrigin(
      doc,
      item,
      collected.parentIndex,
      origin.x + delta.x,
      origin.y + delta.y,
    );
    if (!transform) {
      skipped++;
      continue;
    }
    if (
      Math.abs(transform[4] - item.node.transform[4]) <= POSITION_EPSILON &&
      Math.abs(transform[5] - item.node.transform[5]) <= POSITION_EPSILON
    ) {
      skipped++;
      continue;
    }
    positions.push({ id: item.id, x: transform[4], y: transform[5] });
  }

  return {
    positions,
    eligibleRootIds: collected.eligibleRootIds,
    reparentableRootIds: collected.reparentableRootIds,
    rootCount: collected.rootCount,
    locked: collected.lockedCount,
    skipped,
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
  const explicitBounds = explicitAlignmentBounds(options);
  if (options.reference && options.reference !== 'selection' && !explicitBounds) return doc;
  if (items.length < (explicitBounds ? 1 : 2)) return doc;

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
  const mode = options.mode ?? 'equalGap';
  const hasExplicitGap = options.gap !== undefined;
  if (items.length < (hasExplicitGap ? 2 : 3)) return doc;

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
 * Arrange eligible selection roots into a deterministic grid while preserving
 * the selection's top-left world anchor. This is a one-time transform: it
 * never writes layout metadata or changes scene hierarchy.
 */
export function tidySelectionInDocument(
  doc: Document,
  selection: readonly NodeId[],
  maxCols = 4,
  options: TidyLayoutOptions = {},
): Document {
  const collected = collectSelection(doc, selection);
  const { items } = collected;
  if (items.length < 2) return doc;

  const columns = Number.isFinite(maxCols) ? Math.max(1, Math.floor(maxCols)) : 4;

  const layout = computeTidyLayout(
    items.map((item) => item.bounds),
    columns,
    options,
  );
  if (layout.assignments.length === 0) return doc;

  const originX = Math.min(...items.map((item) => item.bounds.x));
  const originY = Math.min(...items.map((item) => item.bounds.y));
  const deltas = items.map((item, index) => {
    const assignment = layout.assignments[index];
    if (!assignment) return { id: item.id, x: 0, y: 0 };
    const [row, col] = assignment;
    return {
      id: item.id,
      x: originX + col * (layout.colWidth + layout.columnGap) - item.bounds.x,
      y: originY + row * (layout.rowHeight + layout.rowGap) - item.bounds.y,
    };
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
  const explicitBounds = explicitAlignmentBounds(options);
  if (options.reference && options.reference !== 'selection' && !explicitBounds) return doc;
  if (items.length < (explicitBounds ? 1 : 2)) return doc;

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

/**
 * Describe the relationship produced by an alignment command.
 *
 * This intentionally accepts both documents: using the post-command bounds
 * prevents the feedback from describing a pre-operation selection snapshot.
 * The same reference/options and OBB mode used by the command are required so
 * the guide remains truthful for page, frame, key-object, and single-item
 * alignment.
 */
export function alignmentFeedbackForResult(
  before: Document,
  after: Document,
  selection: readonly NodeId[],
  axis: AlignAxis,
  options: AlignSelectionOptions = {},
  oriented = false,
): AlignmentFeedback | null {
  if (before === after) return null;

  const collected = collectSelection(after, selection);
  if (collected.items.length === 0) return null;

  let position: number | null = null;
  if (oriented) {
    const items = collected.items.flatMap((item) => {
      const local = nodeLocalBounds(item.node, after);
      if (!local) return [];
      const transform = nodeWorldTransform(after, item.id, collected.parentIndex);
      if (!isFiniteAffine(transform)) return [];
      return [{ ...item, obb: transformedRectCorners(transform, local) }];
    });
    if (items.length === 0) return null;
    position = resolveObbTarget(items, axis, options);
  } else {
    const target = resolveAlignmentTarget(collected.items, axis, options);
    position = target ? alignmentTargetCoordinate(axis, target) : null;
  }
  if (position === null || !Number.isFinite(position)) return null;

  const movedIds = changedTransformIds(before, after, selection);
  if (movedIds.length === 0) return null;

  const reference = options.reference ?? 'selection';
  const keyIsValid = Boolean(
    options.keyObjectId && collected.items.some((item) => item.id === options.keyObjectId),
  );
  const referenceLabel = keyIsValid
    ? 'Key object'
    : reference === 'page'
      ? 'Page'
      : reference === 'container'
        ? 'Frame'
        : 'Selection';
  const axisLabel: Record<AlignAxis, string> = {
    left: 'Left edge',
    centerH: 'Horizontal center',
    right: 'Right edge',
    top: 'Top edge',
    centerV: 'Vertical center',
    bottom: 'Bottom edge',
  };

  return {
    lines: [
      {
        axis: axis === 'left' || axis === 'centerH' || axis === 'right' ? 'vertical' : 'horizontal',
        position,
        label: `${axisLabel[axis]} · ${referenceLabel}`,
      },
    ],
    movedIds,
    reference,
    keyObjectId: keyIsValid ? (options.keyObjectId ?? null) : null,
  };
}

/**
 * Describe the spacing relationship produced by a distribution command. The
 * guide positions come from the post-command bounds, so unequal-size and
 * fixed-gap operations cannot display a pre-operation estimate.
 */
export function distributionFeedbackForResult(
  before: Document,
  after: Document,
  selection: readonly NodeId[],
  axis: DistributeAxis,
  options: DistributeSelectionOptions = {},
): AlignmentFeedback | null {
  if (before === after) return null;
  const movedIds = changedTransformIds(before, after, selection);
  if (movedIds.length === 0) return null;

  const mode = options.mode ?? 'equalGap';
  const items = collectSelection(after, selection).items.sort((a, b) =>
    compareItems(axis, mode, a, b),
  );
  if (items.length < 2) return null;

  const lines: AlignmentGuideLine[] = [];
  if (mode === 'equalCenter') {
    const centers = items.map((item) =>
      axis === 'horizontal' ? item.bounds.x + item.bounds.w / 2 : item.bounds.y + item.bounds.h / 2,
    );
    const spacing = centers[1]! - centers[0]!;
    if (!Number.isFinite(spacing)) return null;
    const lineAxis = axis === 'horizontal' ? 'vertical' : 'horizontal';
    for (const [index, position] of centers.entries()) {
      lines.push({
        axis: lineAxis,
        position,
        label:
          index === Math.floor(centers.length / 2)
            ? `Equal centers · ${formatArrangementValue(spacing)}`
            : undefined,
      });
    }
  } else {
    const lineAxis = axis === 'horizontal' ? 'vertical' : 'horizontal';
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1]!.bounds;
      const current = items[index]!.bounds;
      const previousEnd = axis === 'horizontal' ? previous.x + previous.w : previous.y + previous.h;
      const currentStart = axis === 'horizontal' ? current.x : current.y;
      const gap = currentStart - previousEnd;
      const position = (previousEnd + currentStart) / 2;
      if (!Number.isFinite(gap) || !Number.isFinite(position)) continue;
      lines.push({
        axis: lineAxis,
        position,
        label: `Gap ${formatArrangementValue(gap)}`,
      });
    }
  }
  if (lines.length === 0) return null;
  return {
    lines,
    movedIds,
    reference: 'selection',
    keyObjectId: null,
  };
}

function changedTransformIds(
  before: Document,
  after: Document,
  selection: readonly NodeId[],
): NodeId[] {
  return selection.filter((id) => {
    const oldTransform = before.nodes[id]?.transform;
    const newTransform = after.nodes[id]?.transform;
    return Boolean(
      oldTransform &&
        newTransform &&
        oldTransform.some((value, index) => value !== newTransform[index]),
    );
  });
}

function formatArrangementValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function collectSelection(doc: Document, selection: readonly NodeId[]): CollectedSelection {
  const collected = collectManualPositionRoots(doc, selection);
  const items: SelectionItem[] = [];

  for (const item of collected.items) {
    const bounds = nodeWorldBounds(doc, item.id, collected.parentIndex);
    if (!isFiniteBounds(bounds)) continue;
    items.push({ ...item, bounds });
  }

  return {
    items,
    parentIndex: collected.parentIndex,
    rootCount: collected.rootCount,
    hasLockedOrHiddenSelection: collected.hasLockedOrHiddenSelection,
    hasLayoutManagedSelection: collected.hasLayoutManagedSelection,
  };
}

function collectManualPositionRoots(
  doc: Document,
  selection: readonly NodeId[],
): CollectedManualPositionRoots {
  const parentIndex = buildParentIndexMap(doc);
  const requested = new Set<NodeId>();
  let skippedCount = 0;

  for (const id of selection) {
    if (requested.has(id)) {
      skippedCount++;
      continue;
    }
    if (!doc.nodes[id]) {
      skippedCount++;
      continue;
    }
    requested.add(id);
  }

  const roots = [...requested].filter((id) => !hasSelectedAncestor(id, requested, parentIndex));
  skippedCount += requested.size - roots.length;
  const items: ManualPositionItem[] = [];
  const eligibleRootIds: NodeId[] = [];
  const reparentableRootIds: NodeId[] = [];
  let lockedCount = 0;
  let hasLockedOrHiddenSelection = false;
  let hasLayoutManagedSelection = false;

  for (const id of roots) {
    const node = doc.nodes[id];
    if (!node) {
      skippedCount++;
      continue;
    }
    const parentId = parentIndex.get(id) ?? null;
    const eligibility = manualPositionEligibility(doc, id, parentId, parentIndex);
    if (eligibility === 'locked-or-hidden') {
      lockedCount++;
      hasLockedOrHiddenSelection = true;
      continue;
    }
    if (eligibility === 'layout-managed') {
      skippedCount++;
      hasLayoutManagedSelection = true;
      reparentableRootIds.push(id);
      continue;
    }
    if (eligibility !== 'eligible') {
      skippedCount++;
      continue;
    }
    items.push({ id, node, parentId });
    eligibleRootIds.push(id);
    reparentableRootIds.push(id);
  }

  return {
    items,
    eligibleRootIds,
    reparentableRootIds,
    parentIndex,
    rootCount: roots.length,
    lockedCount,
    skippedCount,
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
  if (current) return 'invalid-transform';

  const node = doc.nodes[id];
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (node?.kind === 'adjustment') return 'invalid-transform';
  if (parent?.kind === 'frame' && parent.layoutStyle && node?.layoutPosition !== 'absolute') {
    return 'layout-managed';
  }
  if (!node || !isFiniteAffine(node.transform)) return 'invalid-transform';
  const world = nodeWorldTransform(doc, id, parentIndex);
  if (!isFiniteAffine(world)) return 'invalid-transform';
  if (parentId) {
    const parentWorld = nodeWorldTransform(doc, parentId, parentIndex);
    if (!isFiniteAffine(parentWorld) || !tryInvertAffine(parentWorld)) return 'invalid-transform';
  }
  return 'eligible';
}

function resolveAlignmentTarget(
  items: readonly SelectionItem[],
  axis: AlignAxis,
  options: AlignSelectionOptions,
): AlignmentTarget | null {
  const explicitBounds = explicitAlignmentBounds(options);
  if (explicitBounds) return targetForBounds(explicitBounds);
  const keyItem = options.keyObjectId
    ? items.find((item) => item.id === options.keyObjectId)
    : null;
  if (keyItem) return targetForBounds(keyItem.bounds);
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
  const explicitBounds = explicitAlignmentBounds(options);
  if (explicitBounds) return alignmentTargetCoordinateFromBounds(axis, explicitBounds);
  const keyItem = options.keyObjectId
    ? items.find((item) => item.id === options.keyObjectId)
    : null;
  if (keyItem) return obbAlignmentTarget(axis, [keyItem.obb]);
  return obbAlignmentTarget(
    axis,
    items.map((item) => item.obb),
  );
}

function explicitAlignmentBounds(options: AlignSelectionOptions): BBox | null {
  const reference =
    options.reference ?? (isFiniteBounds(options.pageBounds) ? 'page' : 'selection');
  if (reference === 'page') return isFiniteBounds(options.pageBounds) ? options.pageBounds! : null;
  if (reference === 'container') {
    return isFiniteBounds(options.containerBounds) ? options.containerBounds! : null;
  }
  return null;
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
  item: ManualPositionItem,
  parentIndex: Map<NodeId, NodeId>,
  deltaX: number,
  deltaY: number,
): Affine | null {
  const current = item.node.transform as Affine;
  if (!isFiniteAffine(current)) return null;

  const worldTransform = nodeWorldTransform(doc, item.id, parentIndex);
  if (!isFiniteAffine(worldTransform)) return null;
  return translatedLocalTransformToWorldOrigin(
    doc,
    item,
    parentIndex,
    worldTransform[4] + deltaX,
    worldTransform[5] + deltaY,
  );
}

function translatedLocalTransformToWorldOrigin(
  doc: Document,
  item: ManualPositionItem,
  parentIndex: Map<NodeId, NodeId>,
  targetWorldX: number,
  targetWorldY: number,
): Affine | null {
  const current = item.node.transform as Affine;
  if (!isFiniteAffine(current)) return null;

  if (!item.parentId) {
    return Number.isFinite(targetWorldX) && Number.isFinite(targetWorldY)
      ? [current[0], current[1], current[2], current[3], targetWorldX, targetWorldY]
      : null;
  }

  const parentWorld = nodeWorldTransform(doc, item.parentId, parentIndex);
  const parentInverse = tryInvertAffine(parentWorld);
  if (!parentInverse) return null;

  const targetLocal = applyAffine(parentInverse, [targetWorldX, targetWorldY]);
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

function alignmentTargetCoordinate(axis: AlignAxis, target: AlignmentTarget): number {
  switch (axis) {
    case 'left':
      return target.left;
    case 'centerH':
      return target.centerX;
    case 'right':
      return target.right;
    case 'top':
      return target.top;
    case 'centerV':
      return target.centerY;
    case 'bottom':
      return target.bottom;
  }
}

function alignmentTargetCoordinateFromBounds(axis: AlignAxis, bounds: BBox): number {
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

function isDescendantOf(id: NodeId, ancestorId: NodeId, parentIndex: Map<NodeId, NodeId>): boolean {
  let current = parentIndex.get(id) ?? null;
  const visited = new Set<NodeId>();
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = parentIndex.get(current) ?? null;
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
