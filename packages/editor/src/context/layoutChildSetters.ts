/**
 * Batch-apply a layout child field (sizing mode or flow position) to a
 * selection, then reflow every affected parent. Pulled out of context.tsx —
 * the four setters that used to inline this loop were identical except for
 * which field they wrote, and context.tsx is already at its complexity
 * ceiling.
 */
import { reflowLayoutChildren } from '@varve/layout';
import type {
  Document,
  LayoutAlign,
  LayoutPosition,
  LayoutSizing,
  NodeId,
  SceneNode,
} from '@varve/scene';
import { getParent } from '@varve/scene';

type LayoutChildField =
  | 'layoutSizing'
  | 'layoutSizingWidth'
  | 'layoutSizingHeight'
  | 'layoutPosition'
  | 'layoutAlign';
type LayoutChildValue<K extends LayoutChildField> = K extends 'layoutPosition'
  ? LayoutPosition
  : K extends 'layoutAlign'
    ? LayoutAlign
    : LayoutSizing;

export function applySelectedLayoutChildField<K extends LayoutChildField>(
  doc: Document,
  selection: readonly NodeId[],
  field: K,
  value: LayoutChildValue<K>,
): Document {
  if (selection.length === 0) return doc;

  const nodes = { ...doc.nodes };
  // Frames to re-run layout on: the changed node's parent (its sizing/
  // position affects the parent's flow and hug measurement), and the
  // changed node itself when it's a frame with its own layoutStyle — its
  // own "hug"/"fill" mode governs how IT sizes against ITS children, which
  // only resolves when reflow runs rooted at the frame itself, not just
  // when a parent happens to reflow it as a side effect.
  const framesToReflow = new Set<NodeId>();
  for (const id of selection) {
    const node = nodes[id];
    if (!node) continue;
    nodes[id] = { ...node, [field]: value } as SceneNode;
    // Self before parent: resolves this frame's own hug size first, so the
    // parent reflow (if also needed) sees the up-to-date box rather than
    // relying on the extra propagation bounce reflowLayoutChildren does when
    // a self-reflow changes the frame's size.
    if (node.kind === 'frame' && node.layoutStyle) framesToReflow.add(id);
    const parentId = getParent(doc, id);
    if (parentId) framesToReflow.add(parentId);
  }

  let next = { ...doc, nodes };
  for (const frameId of framesToReflow) next = reflowLayoutChildren(next, frameId);
  return next;
}
