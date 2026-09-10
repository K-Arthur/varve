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
  Fill,
  LayoutAlign,
  LayoutPosition,
  LayoutSizing,
  NodeId,
  SceneNode,
} from '@varve/scene';
import { getParent, nodeLocalBounds } from '@varve/scene';

type LayoutChildField =
  | 'layoutSizing'
  | 'layoutSizingWidth'
  | 'layoutSizingHeight'
  | 'layoutRelativeWidth'
  | 'layoutRelativeHeight'
  | 'layoutPosition'
  | 'layoutAlign';
type LayoutChildValue<K extends LayoutChildField> = K extends 'layoutPosition'
  ? LayoutPosition
  : K extends 'layoutAlign'
    ? LayoutAlign
    : K extends 'layoutRelativeWidth' | 'layoutRelativeHeight'
      ? number
      : LayoutSizing;

type ConstraintField = 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight';

export function mergePaintValue(current: Fill | undefined, patch: Fill): Fill {
  return current?.type === patch.type ? { ...current, ...patch } : patch;
}

/** Apply one optional size bound to every selected node without duplicating
 * mutation logic in the EditorProvider hub. Setting a minimum raises an
 * existing maximum; setting a maximum clamps it to the existing minimum. */
export function applySelectedConstraint(
  doc: Document,
  selection: readonly NodeId[],
  field: ConstraintField,
  value?: number,
): Document {
  if (selection.length === 0) return doc;
  if (
    (field === 'minWidth' ||
      field === 'maxWidth' ||
      field === 'minHeight' ||
      field === 'maxHeight') &&
    (value === undefined || !Number.isFinite(value) || value < 0)
  ) {
    return doc;
  }
  const nodes = { ...doc.nodes };
  for (const id of selection) {
    const node = nodes[id];
    if (!node) continue;
    if (value === undefined) {
      const { [field]: _removed, ...rest } = node;
      nodes[id] = rest as SceneNode;
      continue;
    }
    const axis = field.endsWith('Width') ? 'Width' : 'Height';
    const counterpart = `${field.startsWith('min') ? 'max' : 'min'}${axis}` as ConstraintField;
    const existing = node[counterpart];
    const nextValue = typeof existing === 'number' ? Math.max(value, existing) : value;
    nodes[id] = { ...node, [field]: nextValue } as SceneNode;
  }
  return { ...doc, nodes };
}

export function applySelectedLayoutChildField<K extends LayoutChildField>(
  doc: Document,
  selection: readonly NodeId[],
  field: K,
  value: LayoutChildValue<K>,
): Document {
  if (selection.length === 0) return doc;
  if (
    (field === 'layoutRelativeWidth' || field === 'layoutRelativeHeight') &&
    (!Number.isFinite(value as number) || (value as number) < 0)
  ) {
    return doc;
  }

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
    const parentId = getParent(doc, id);
    const parent = parentId ? doc.nodes[parentId] : undefined;
    const parentFrame = parent?.kind === 'frame' ? parent : undefined;
    let nextNode = { ...node, [field]: value } as SceneNode;
    if (field === 'layoutSizingWidth' || field === 'layoutSizingHeight') {
      const axis = field === 'layoutSizingWidth' ? 'width' : 'height';
      if (value === 'relative') {
        const padding = parentFrame?.layoutStyle?.padding ?? [0, 0, 0, 0];
        const reference =
          axis === 'width'
            ? (parentFrame?.w ?? 0) - padding[1] - padding[3]
            : (parentFrame?.h ?? 0) - padding[0] - padding[2];
        const bounds = nodeLocalBounds(node);
        const dimension = axis === 'width' ? (bounds?.w ?? 0) : (bounds?.h ?? 0);
        const percent =
          reference > 0 && Number.isFinite(dimension)
            ? Math.max(0, (dimension / reference) * 100)
            : 100;
        nextNode = {
          ...nextNode,
          [axis === 'width' ? 'layoutRelativeWidth' : 'layoutRelativeHeight']: percent,
        } as SceneNode;
      }
    }
    nodes[id] = nextNode;
    // Self before parent: resolves this frame's own hug size first, so the
    // parent reflow (if also needed) sees the up-to-date box rather than
    // relying on the extra propagation bounce reflowLayoutChildren does when
    // a self-reflow changes the frame's size.
    if (node.kind === 'frame' && node.layoutStyle) framesToReflow.add(id);
    if (parentId) framesToReflow.add(parentId);
  }

  let next = { ...doc, nodes };
  for (const frameId of framesToReflow) next = reflowLayoutChildren(next, frameId);
  return next;
}
