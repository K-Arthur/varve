// Non-destructive Boolean scene-graph support.
//
// A live Boolean is a normal group whose direct children are its operands.
// There is deliberately no persisted resolved path: output is derived at read
// time, so changing a child path, transform, or operation immediately changes
// the visible result and history can restore the original structure exactly.

import { type Affine, identity, multiplyAffine, tryInvertAffine } from '@varve/shared';
import { booleanAnchorForNode, booleanOp, placeBooleanResult } from './boolean/integration';
import { nodeWorldTransform } from './coordinateService';
import type { Document } from './document';
import { addNode, removeNode, reparentNode } from './document-nodes';
import { makeGroupNode } from './document-utils';
import { nextNodeId } from './node-id';
import type { GroupNode, NodeId, ShapeNode } from './types';
import { isLiveBooleanNode } from './types';

export type LiveBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';

/** Live Booleans can nest, but their graph remains a strict child tree. */
const MAX_LIVE_BOOLEAN_DEPTH = 32;

function isSupportedOperation(operation: string): operation is LiveBooleanOperation {
  return (
    operation === 'union' ||
    operation === 'subtract' ||
    operation === 'intersect' ||
    operation === 'exclude'
  );
}

function isBooleanOperand(node: ShapeNode | GroupNode): boolean {
  if (isLiveBooleanNode(node)) return true;
  // An open path has no filled region. Keeping it inside a live Boolean would
  // create a group that can never resolve, so reject it at creation time.
  return node.shape.kind !== 'path' || node.shape.closed !== false;
}

function makeLiveBooleanNode(id: NodeId, operation: LiveBooleanOperation): GroupNode {
  return makeGroupNode(id, {
    name: `Boolean ${operation[0]!.toUpperCase()}${operation.slice(1)}`,
    transform: identity,
    boolean: { schemaVersion: 1, operation },
  });
}

/** Resolve an editable Boolean group into a world-space ShapeNode. */
export function resolveLiveBooleanShape(
  document: Document,
  nodeId: NodeId,
  ancestors: readonly NodeId[] = [],
): ShapeNode | null {
  const node = document.nodes[nodeId];
  if (!node || !isLiveBooleanNode(node) || !isSupportedOperation(node.boolean.operation))
    return null;
  if (ancestors.includes(nodeId) || ancestors.length >= MAX_LIVE_BOOLEAN_DEPTH) return null;

  const operands: ShapeNode[] = [];
  for (const childId of node.children) {
    const child = document.nodes[childId];
    if (!child || child.visible === false) continue;
    if (child.kind === 'shape') {
      operands.push({ ...child, transform: nodeWorldTransform(document, childId) });
      continue;
    }
    if (isLiveBooleanNode(child)) {
      const resolvedChild = resolveLiveBooleanShape(document, childId, [...ancestors, nodeId]);
      if (resolvedChild) operands.push(resolvedChild);
      continue;
    }
    // Filled Boolean geometry is defined for closed filled shapes. Unsupported
    // children remain editable in Layers but make the live result unavailable.
    return null;
  }
  if (operands.length < 2) return null;

  const resolved = booleanOp(node.boolean.operation, operands);
  return {
    ...resolved,
    id: node.id,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
  };
}

/**
 * Replace selected filled shapes with one live Boolean group, preserving every
 * child world transform even when operands come from different parents.
 */
export function createLiveBooleanDoc(
  document: Document,
  operandIds: readonly NodeId[],
  operation: LiveBooleanOperation,
): { doc: Document; nodeId: NodeId } | null {
  const uniqueIds = [...new Set(operandIds)];
  if (uniqueIds.length < 2 || !isSupportedOperation(operation)) return null;
  if (
    !uniqueIds.every((id) => {
      const operand = document.nodes[id];
      return (
        (operand?.kind === 'shape' && isBooleanOperand(operand)) ||
        (operand !== undefined && isLiveBooleanNode(operand) && isBooleanOperand(operand))
      );
    })
  ) {
    return null;
  }

  const anchor = booleanAnchorForNode(document, uniqueIds[0]!);
  const parentWorld = anchor.parentId ? nodeWorldTransform(document, anchor.parentId) : identity;
  const parentInverse = tryInvertAffine(parentWorld);
  if (!parentInverse) return null;

  const operandTransforms = new Map<NodeId, Affine>();
  for (const id of uniqueIds) {
    operandTransforms.set(id, multiplyAffine(parentInverse, nodeWorldTransform(document, id)));
  }

  const { id, doc: withId } = nextNodeId(document);
  let doc = addNode(withId, makeLiveBooleanNode(id, operation));
  doc = reparentNode(doc, id, anchor.parentId, anchor.index, identity);
  for (const [index, operandId] of uniqueIds.entries()) {
    doc = reparentNode(doc, operandId, id, index, operandTransforms.get(operandId));
  }
  return { doc, nodeId: id };
}

/** Expand a live Boolean atomically into its resolved editable compound path. */
export function expandLiveBooleanDoc(
  document: Document,
  nodeId: NodeId,
): { doc: Document; nodeId: NodeId } | null {
  const resolved = resolveLiveBooleanShape(document, nodeId);
  if (!resolved) return null;
  const anchor = booleanAnchorForNode(document, nodeId);
  const withoutLiveGroup = removeNode(document, nodeId);
  return placeBooleanResult(withoutLiveGroup, resolved, anchor);
}

/** Change operation without altering source operands or their transforms. */
export function setLiveBooleanOperation(
  document: Document,
  nodeId: NodeId,
  operation: LiveBooleanOperation,
): Document {
  const node = document.nodes[nodeId];
  if (!node || !isLiveBooleanNode(node) || !isSupportedOperation(operation)) return document;
  return {
    ...document,
    nodes: {
      ...document.nodes,
      [nodeId]: { ...node, boolean: { ...node.boolean, operation } },
    },
  };
}

/** Reorder source operands; meaningful only for subtract's explicit base. */
export function reorderLiveBooleanOperands(
  document: Document,
  nodeId: NodeId,
  childIds: readonly NodeId[],
): Document {
  const node = document.nodes[nodeId];
  if (!node || !isLiveBooleanNode(node)) return document;
  if (childIds.length !== node.children.length || new Set(childIds).size !== node.children.length)
    return document;
  if (!childIds.every((id) => node.children.includes(id))) return document;
  return {
    ...document,
    nodes: { ...document.nodes, [nodeId]: { ...node, children: [...childIds] } },
  };
}
