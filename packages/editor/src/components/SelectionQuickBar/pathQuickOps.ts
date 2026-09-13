/**
 * Path quick ops — simplify / open / close for selection bar actions.
 *
 * Research basis: Illustrator Object > Path > Simplify; Figma close-path.
 */
import { type PathPoint, simplifyPathRDP } from '@varve/engine';
import type { Document, NodeId, ShapeNode } from '@varve/scene';
import { pathRings, reversePathShape, withPathRings } from '@varve/shared';

function getPathShape(doc: Document, nodeId: NodeId): ShapeNode | null {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || node.shape.kind !== 'path') return null;
  return node;
}

/** Toggle or set path closed flag. */
export function setPathClosed(doc: Document, nodeId: NodeId, closed: boolean): Document {
  const node = getPathShape(doc, nodeId);
  if (node?.shape.kind !== 'path') return doc;
  if (node.shape.closed === closed) return doc;
  const updated: ShapeNode = {
    ...node,
    shape: { ...node.shape, closed },
  };
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}

/** RDP-simplify path points (preserves endpoints / closed semantics). */
export function simplifyPathNode(doc: Document, nodeId: NodeId, epsilon = 1.5): Document {
  const node = getPathShape(doc, nodeId);
  if (node?.shape.kind !== 'path') return doc;
  const rings = pathRings(node.shape);
  const results = rings.map((ring) =>
    simplifyPathRDP(ring as PathPoint[], epsilon, node.shape.closed),
  );
  if (results.every((result) => result.simplifiedCount >= result.originalCount)) return doc;
  const simplifiedRings = results.map((result) => result.points);
  const updated: ShapeNode = {
    ...node,
    shape: withPathRings(node.shape, simplifiedRings),
  };
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}

/** Reverse every authored contour while preserving incoming/outgoing vectors. */
export function reversePathNode(doc: Document, nodeId: NodeId): Document {
  const node = getPathShape(doc, nodeId);
  if (node?.shape.kind !== 'path') return doc;
  const updated: ShapeNode = {
    ...node,
    shape: reversePathShape(node.shape),
  };
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}
