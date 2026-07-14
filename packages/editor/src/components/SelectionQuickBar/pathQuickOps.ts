/**
 * Path quick ops — simplify / open / close for selection bar actions.
 *
 * Research basis: Illustrator Object > Path > Simplify; Figma close-path.
 */
import { type PathPoint, simplifyPathRDP } from '@strata/engine';
import type { Document, NodeId, ShapeNode } from '@strata/scene';

function getPathShape(doc: Document, nodeId: NodeId): ShapeNode | null {
  const node = doc.nodes[nodeId];
  if (!node || node.kind !== 'shape' || node.shape.kind !== 'path') return null;
  return node;
}

/** Toggle or set path closed flag. */
export function setPathClosed(doc: Document, nodeId: NodeId, closed: boolean): Document {
  const node = getPathShape(doc, nodeId);
  if (!node || node.shape.kind !== 'path') return doc;
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
  if (!node || node.shape.kind !== 'path') return doc;
  const pts = node.shape.points as PathPoint[];
  if (pts.length <= 2) return doc;
  const result = simplifyPathRDP(pts, epsilon, node.shape.closed);
  if (result.simplifiedCount >= result.originalCount) return doc;
  const updated: ShapeNode = {
    ...node,
    shape: { ...node.shape, points: result.points },
  };
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}
