import type { Document } from './document';
import type { FrameNode, NodeId, SceneNode } from './types';

/**
 * Resolve a container's effective paint order without mutating authored
 * children. Flow participants may be reversed for overlap previews while
 * absolute children, mask sources, adjustment layers, and component slots
 * keep their authored slots and ownership boundaries.
 */
export function effectivePaintOrder(doc: Document, parent: SceneNode | NodeId): NodeId[] {
  const node = typeof parent === 'string' ? doc.nodes[parent] : parent;
  if (!node || !('children' in node)) return [];
  const children = [...node.children];
  if (node.kind !== 'frame' || node.layoutStyle?.overlapOrder !== 'firstOnTop') return children;

  const frame = node as FrameNode;
  const maskSourceId = frame.mask?.sourceNodeId;
  const flowSlots: number[] = [];
  const flowChildren: NodeId[] = [];
  for (let index = 0; index < children.length; index++) {
    const child = doc.nodes[children[index]!];
    if (
      !child ||
      child.id === maskSourceId ||
      child.kind === 'adjustment' ||
      child.layoutPosition === 'absolute'
    )
      continue;
    flowSlots.push(index);
    flowChildren.push(child.id);
  }
  flowChildren.reverse();
  const resolved = [...children];
  for (const [slotIndex, childId] of flowSlots.map(
    (slot, index) => [slot, flowChildren[index]!] as const,
  )) {
    resolved[slotIndex] = childId;
  }
  return resolved;
}
