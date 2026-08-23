/**
 * Adjustment scope model — explicit, serializable targeting for
 * nondestructive image adjustments.
 *
 * Five distinct scope modes, each with deterministic target resolution:
 *
 * 1. **image-local** — attached to exactly one node. Default for single-image
 *    selection. Moves, duplicates, and nests with that image.
 * 2. **explicit-targets** — one adjustment references a defined set of eligible
 *    nodes. Default for editing a multi-selection.
 * 3. **container-descendant** — applies to eligible descendants of a frame,
 *    group, or dedicated adjustment container. Nested-container and isolation
 *    semantics defined below.
 * 4. **document** — applies to all eligible nodes in the document. Requires
 *    an impact-summary preview before creation (never accidental).
 *
 * Every scope stores IDs, never computed lists, so save/reopen is stable.
 *
 * Research basis: Adobe Photoshop adjustment layers (all-below / clipping /
 *    per-layer), Affinity Photo live filter layers (scope-to-parent),
 *    Capture One styles (apply-to-selected-only), Lightroom virtual copies.
 */
import type { Document } from './document';
import type { AdjustmentScope, NodeId } from './types';
import { isContainer } from './types';

/**
 * Metadata for an impact summary shown before applying a broad scope.
 */
export interface AdjustmentImpact {
  targetCount: number;
  affectedFrames: number;
  affectedPages: number;
  estimatedPixelArea: number;
  activeAdjustmentCount: number;
  hasOffscreenTargets: boolean;
}

/**
 * Eligible target types for adjustment application. Adjustments operate on
 * the composited result of both raster and vector scene nodes, so vector
 * paths/tables participate just like shapes, text, frames, and groups.
 */
export function isAdjustmentEligible(node: { kind: string; visible?: boolean }): boolean {
  if (node.visible === false) return false;
  return (
    node.kind === 'shape' ||
    node.kind === 'rasterLayer' ||
    node.kind === 'text' ||
    node.kind === 'path' ||
    node.kind === 'table' ||
    node.kind === 'frame' ||
    node.kind === 'group'
  );
}

/**
 * Walk container children to find all eligible descendant node IDs.
 * When `includeNested` is false, only direct children of the
 * container are returned (no recursion into nested containers).
 * When true, recurses into all descendant containers.
 */
export function collectContainerDescendants(
  doc: Document,
  containerId: NodeId,
  includeNested: boolean,
): NodeId[] {
  const container = doc.nodes[containerId];
  if (!container || !isContainer(container)) return [];

  const result: NodeId[] = [];
  const visit = (parentId: NodeId, isRoot: boolean) => {
    const parent = doc.nodes[parentId];
    if (!parent || !isContainer(parent)) return;
    for (const childId of parent.children) {
      const child = doc.nodes[childId];
      if (!child) continue;
      if (child.kind === 'adjustment') continue;
      if (isAdjustmentEligible(child)) {
        result.push(childId);
      }
      if (isContainer(child) && (includeNested || !isRoot)) {
        visit(childId, false);
      }
    }
  };

  visit(containerId, true);
  return result;
}

/**
 * Resolve an adjustment scope to the set of node IDs it affects.
 * Deterministic — same doc + scope always returns the same set (provided
 * the doc hasn't been mutated).
 *
 * Validation: deleted/missing targets are silently dropped.
 * If the resolved set is empty, the adjustment has no effect.
 */
export function resolveAdjustmentScope(
  doc: Document,
  scope: AdjustmentScope | undefined,
  adjustmentNodeId: NodeId,
): NodeId[] {
  if (!scope) {
    return resolveLegacyScope(doc, adjustmentNodeId);
  }

  let resolved: NodeId[] = [];
  switch (scope.mode) {
    case 'image-local': {
      const target = doc.nodes[scope.targetNodeId];
      resolved = target && isAdjustmentEligible(target) ? [scope.targetNodeId] : [];
      break;
    }

    case 'explicit-targets': {
      resolved = scope.targetNodeIds.filter((id) => {
        const target = doc.nodes[id];
        return !!target && isAdjustmentEligible(target);
      });
      break;
    }

    case 'container-descendant': {
      resolved = collectContainerDescendants(doc, scope.containerId, scope.includeNested);
      break;
    }

    case 'document': {
      resolved = collectAllEligibleNodes(doc);
      break;
    }
  }

  // Scope resolution is a render-graph boundary. De-duplicate IDs and reject
  // an adjustment's own subtree so malformed or hand-authored documents cannot
  // make the adjustment replay itself recursively. Missing targets are already
  // filtered above and remain harmless after deletion/copy-paste repair.
  const unique = new Set<NodeId>();
  const candidates = resolved.filter((id) => {
    if (unique.has(id) || id === adjustmentNodeId) return false;
    if (isDescendantOf(doc, adjustmentNodeId, id)) return false;
    unique.add(id);
    return true;
  });

  // A parent target already contains its descendants. Keep only the outermost
  // selected node so a group and its child are not replayed or filtered twice.
  return candidates.filter(
    (id) => !candidates.some((other) => other !== id && isDescendantOf(doc, id, other)),
  );
}

/**
 * Legacy resolution: when no scope exists, find the sibling immediately
 * below this adjustment in the same parent. If none, search upward.
 * This preserves the intent of the unused `clipping: boolean` field
 * while making it explicit.
 */
function resolveLegacyScope(doc: Document, adjustmentNodeId: NodeId): NodeId[] {
  const adjustmentNode = doc.nodes[adjustmentNodeId];
  if (!adjustmentNode) return [];

  const parentId = findParentId(doc, adjustmentNodeId);
  if (!parentId) {
    // Root-level adjustment without scope — legacy behaviour was "all root nodes"
    // We return just the eligible root siblings below this adjustment
    const ownIdx = doc.rootChildren.indexOf(adjustmentNodeId);
    if (ownIdx === -1) return collectAllEligibleNodes(doc);
    return doc.rootChildren.slice(0, ownIdx).filter((id) => {
      const n = doc.nodes[id];
      return n && isAdjustmentEligible(n);
    });
  }

  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) return [];
  const ownIdx = parent.children.indexOf(adjustmentNodeId);
  if (ownIdx === -1) return [];
  const below = parent.children.slice(0, ownIdx).filter((id) => {
    const n = doc.nodes[id];
    return n && isAdjustmentEligible(n);
  });

  return below;
}

function findParentId(doc: Document, nodeId: NodeId): NodeId | null {
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (isContainer(n) && n.children.includes(nodeId)) {
      return id;
    }
  }
  if (doc.rootChildren.includes(nodeId)) return null;
  return null;
}

/**
 * Collect all eligible nodes across the entire document (for document scope).
 */
export function collectAllEligibleNodes(doc: Document): NodeId[] {
  const result: NodeId[] = [];
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (
      n.visible !== false &&
      isAdjustmentEligible(n as unknown as { kind: string; visible?: boolean })
    ) {
      result.push(id);
    }
  }
  return result;
}

/**
 * Estimate the impact of applying an adjustment with a given scope.
 * Used to show the impact summary dialog before committing.
 */
export function estimateAdjustmentImpact(
  doc: Document,
  scope: AdjustmentScope,
  adjustmentNodeId: NodeId,
): AdjustmentImpact {
  const targets = resolveAdjustmentScope(doc, scope, adjustmentNodeId);
  const frameSet = new Set<NodeId>();
  const pageSet = new Set<NodeId>();
  let totalPixels = 0;

  for (const id of targets) {
    const node = doc.nodes[id];
    if (!node) continue;
    if ('w' in node && typeof node.w === 'number' && 'h' in node && typeof node.h === 'number') {
      totalPixels += (node.w ?? 100) * (node.h ?? 100);
    }
    const parentId = findParentId(doc, id);
    if (parentId) {
      const p = doc.nodes[parentId];
      if (p?.kind === 'frame') frameSet.add(parentId);
    }
  }

  if (doc.pages) {
    for (const page of doc.pages) {
      const contentRoot = doc.nodes[page.contentRoot];
      if (contentRoot && isContainer(contentRoot)) {
        for (const id of targets) {
          if (contentRoot.children.includes(id) || isDescendantOf(doc, id, page.contentRoot)) {
            pageSet.add(page.id);
            break;
          }
        }
      }
    }
  }

  const activeAdjustmentCount = Object.values(doc.nodes).filter(
    (n) => n.kind === 'adjustment' && n.visible !== false,
  ).length;

  return {
    targetCount: targets.length,
    affectedFrames: frameSet.size,
    affectedPages: pageSet.size,
    estimatedPixelArea: totalPixels,
    activeAdjustmentCount,
    hasOffscreenTargets: targets.length > 10,
  };
}

function isDescendantOf(doc: Document, nodeId: NodeId, ancestorId: NodeId): boolean {
  const ancestor = doc.nodes[ancestorId];
  if (!ancestor || !isContainer(ancestor)) return false;
  const visited = new Set<NodeId>();
  const visit = (currentId: NodeId): boolean => {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const current = doc.nodes[currentId];
    if (!current || !isContainer(current)) return false;
    for (const childId of current.children) {
      if (childId === nodeId || visit(childId)) return true;
    }
    return false;
  };
  return visit(ancestorId);
}

/**
 * Create a scope for a given set of target node IDs.
 * Returns a stable explicit scope for a given set of target node IDs:
 * - Single node → image-local
 * - Multi-selection → explicit-targets
 *
 * A multi-selection must not silently expand to every descendant of a shared
 * frame/group. Container scope is reserved for an explicit container
 * selection, where the user can see that the whole container is targeted.
 */
export function scopeForTargets(_doc: Document, targetIds: NodeId[]): AdjustmentScope {
  if (targetIds.length === 0) return { mode: 'document' };
  if (targetIds.length === 1) return { mode: 'image-local', targetNodeId: targetIds[0] as NodeId };

  return { mode: 'explicit-targets', targetNodeIds: [...targetIds] };
}

/**
 * Validate a scope against the current document.
 * Returns an array of diagnostic messages (empty = valid).
 */
export function validateScope(doc: Document, scope: AdjustmentScope): string[] {
  const warnings: string[] = [];

  switch (scope.mode) {
    case 'image-local': {
      if (!doc.nodes[scope.targetNodeId]) {
        warnings.push(`Target node ${scope.targetNodeId} no longer exists`);
      }
      break;
    }
    case 'explicit-targets': {
      const missing = scope.targetNodeIds.filter((id) => !doc.nodes[id]);
      if (missing.length > 0) {
        warnings.push(`${missing.length} target(s) no longer exist`);
      }
      const nonEligible = scope.targetNodeIds.filter(
        (id) => !isAdjustmentEligible(doc.nodes[id] ?? { kind: 'unknown' }),
      );
      if (nonEligible.length > 0) {
        warnings.push(`${nonEligible.length} target(s) are not eligible for adjustment`);
      }
      break;
    }
    case 'container-descendant': {
      const container = doc.nodes[scope.containerId];
      if (!container) {
        warnings.push(`Container ${scope.containerId} no longer exists`);
      } else if (!isContainer(container)) {
        warnings.push(`Node ${scope.containerId} is not a container`);
      }
      break;
    }
    case 'document':
      break;
  }

  return warnings;
}
