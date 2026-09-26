/**
 * extractSubjectLayer — copy an image node and commit the reviewed subject
 * mask on the copy, leaving the source untouched.
 *
 * This is the "extract to a new layer" output of Object Selection. The new
 * layer sits directly above the source, keeps the same placement and fills,
 * and shows only the subject because the reviewed mask is committed to it.
 * Both the clone insertion and the mask commit happen inside one returned
 * document so the caller's single updateDoc becomes one undo entry.
 *
 * The clone deliberately starts WITHOUT the source's raster mask (the
 * reviewed mask replaces it) and without the legacy backgroundRemoval field:
 * a duplicate that kept the source's coverage would show the wrong pixels
 * before the new mask lands, and provenance must describe the extraction,
 * not inherit the source's method.
 */
import type { ContainerNode, Document, NodeId } from '@varve/scene';
import { deepCloneSubtree, getParent } from '@varve/scene';
import { generateKeyBetween } from '@varve/shared';

import { commitRasterMask, type RasterMaskCommitFields } from './commitRasterMask';

export interface ExtractSubjectLayerResult {
  doc: Document;
  newNodeId: NodeId;
}

export function extractSubjectToLayer(
  doc: Document,
  sourceNodeId: NodeId,
  maskCommit: RasterMaskCommitFields,
): ExtractSubjectLayerResult | null {
  const source = doc.nodes[sourceNodeId];
  if (!source) return null;

  const cloned = deepCloneSubtree(doc.nodes, doc.nextId, sourceNodeId, {
    translate: { x: 0, y: 0 },
  });
  const clonedRoot = cloned.nodes[cloned.rootId];
  if (!clonedRoot) return null;

  const stripped: Record<NodeId, typeof clonedRoot> = { ...cloned.nodes };
  const root = { ...clonedRoot };
  delete root.mask;
  // The legacy field only exists on the shape variant.
  if ('backgroundRemoval' in root) delete root.backgroundRemoval;
  // A layer name reads better without the file extension, and the shorter
  // label leaves room for the row's mask badge before the panel's overflow
  // policy truncates it.
  root.name = `${root.name.replace(/\.[a-z0-9]+$/i, '')} subject`;
  stripped[cloned.rootId] = root;

  let next: Document = {
    ...doc,
    nextId: cloned.nextId,
    nodes: { ...doc.nodes, ...stripped },
  };

  // Insert directly above the source: same parent, painted between the
  // source and the sibling above it.
  const parentId = getParent(next, sourceNodeId);
  if (parentId) {
    const parent = next.nodes[parentId];
    if (!parent || !('children' in parent)) return null;
    const container = parent as ContainerNode;
    const siblings = container.children ?? [];
    const index = siblings.indexOf(sourceNodeId);
    if (index < 0) return null;
    const following = siblings[index + 1] ?? null;
    const order = generateKeyBetween(
      next.nodes[sourceNodeId]?.order ?? null,
      following ? (next.nodes[following]?.order ?? null) : null,
    );
    const ordered = { ...root, order };
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [cloned.rootId]: ordered,
        [parentId]: {
          ...container,
          children: [...siblings.slice(0, index + 1), cloned.rootId, ...siblings.slice(index + 1)],
        },
      },
    };
  } else {
    const siblings = next.rootChildren;
    const index = siblings.indexOf(sourceNodeId);
    if (index < 0) return null;
    const following = siblings[index + 1] ?? null;
    const order = generateKeyBetween(
      next.nodes[sourceNodeId]?.order ?? null,
      following ? (next.nodes[following]?.order ?? null) : null,
    );
    next = {
      ...next,
      rootChildren: [...siblings.slice(0, index + 1), cloned.rootId, ...siblings.slice(index + 1)],
      nodes: { ...next.nodes, [cloned.rootId]: { ...root, order } },
    };
  }

  const committed = commitRasterMask(next, cloned.rootId, maskCommit);
  return { doc: committed, newNodeId: cloned.rootId };
}
