/**
 * Layout setter helpers extracted from EditorProvider to reduce its
 * cyclomatic complexity. Each setter updates a per-child layout property
 * and triggers parent reflow.
 */
import type { Document, LayoutPosition, LayoutSizing, SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';

type UpdateDoc = (fn: (doc: Document) => Document) => void;
type Reflow = (doc: Document, parentId: string) => Document;

function batchSetChildLayout(
  updateDoc: UpdateDoc,
  state: { selection: string[]; document: Document },
  prop: 'layoutSizingWidth' | 'layoutSizingHeight' | 'layoutPosition',
  value: LayoutSizing | LayoutPosition,
  reflow: Reflow,
): void {
  if (state.selection.length === 0) return;
  updateDoc((doc) => {
    const nodes = { ...doc.nodes };
    const parents = new Set<string>();
    for (const id of state.selection) {
      const node = nodes[id];
      if (!node) continue;
      nodes[id] = { ...node, [prop]: value } as SceneNode;
      const parentId = getParent(doc, id);
      if (parentId) parents.add(parentId);
    }
    let next = { ...doc, nodes };
    for (const pid of parents) next = reflow(next, pid);
    return next;
  });
}

export function makeLayoutSetters(
  updateDoc: UpdateDoc,
  state: { selection: string[]; document: Document },
  reflow: Reflow,
) {
  return {
    setSelectedLayoutSizingWidth: (value: LayoutSizing) =>
      batchSetChildLayout(updateDoc, state, 'layoutSizingWidth', value, reflow),
    setSelectedLayoutSizingHeight: (value: LayoutSizing) =>
      batchSetChildLayout(updateDoc, state, 'layoutSizingHeight', value, reflow),
    setSelectedLayoutPosition: (value: LayoutPosition) =>
      batchSetChildLayout(updateDoc, state, 'layoutPosition', value, reflow),
  };
}
