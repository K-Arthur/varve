/**
 * Batch-apply a layout child field (sizing mode or flow position) to a
 * selection, then reflow every affected parent. Pulled out of context.tsx —
 * the four setters that used to inline this loop were identical except for
 * which field they wrote, and context.tsx is already at its complexity
 * ceiling.
 */
import { reflowLayoutChildren } from '@varve/layout';
import type { Document, LayoutPosition, LayoutSizing, NodeId, SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';

type LayoutChildField =
  | 'layoutSizing'
  | 'layoutSizingWidth'
  | 'layoutSizingHeight'
  | 'layoutPosition';
type LayoutChildValue<K extends LayoutChildField> = K extends 'layoutPosition'
  ? LayoutPosition
  : LayoutSizing;

export function applySelectedLayoutChildField<K extends LayoutChildField>(
  doc: Document,
  selection: readonly NodeId[],
  field: K,
  value: LayoutChildValue<K>,
): Document {
  if (selection.length === 0) return doc;

  const nodes = { ...doc.nodes };
  const parents = new Set<NodeId>();
  for (const id of selection) {
    const node = nodes[id];
    if (!node) continue;
    nodes[id] = { ...node, [field]: value } as SceneNode;
    const parentId = getParent(doc, id);
    if (parentId) parents.add(parentId);
  }

  let next = { ...doc, nodes };
  for (const parentId of parents) next = reflowLayoutChildren(next, parentId);
  return next;
}
