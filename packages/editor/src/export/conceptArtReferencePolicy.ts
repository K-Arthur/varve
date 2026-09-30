import type { Document, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';

const REFERENCE_EXPORT_REFUSAL =
  'This concept-art reference is excluded from artwork exports. Enable “Include in artwork exports” in the Inspector to export it.';

function isExcludedReference(node: SceneNode | undefined): boolean {
  return (
    node?.kind === 'shape' &&
    node.conceptArtReference !== undefined &&
    node.conceptArtReference.includeInExport !== true
  );
}

/** Make a disposable scene snapshot that omits opted-out reference imagery. */
export function documentForArtworkExport(document: Document): Document {
  let nodes: Document['nodes'] | undefined;

  for (const [id, node] of Object.entries(document.nodes)) {
    if (isExcludedReference(node)) {
      nodes ??= { ...document.nodes };
      nodes[id] = { ...node, visible: false };
      continue;
    }

    if (isContainer(node)) {
      const children = node.children.filter(
        (childId) => !isExcludedReference(document.nodes[childId]),
      );
      if (children.length !== node.children.length) {
        nodes ??= { ...document.nodes };
        nodes[id] = { ...node, children };
      }
    }
  }

  return nodes ? { ...document, nodes } : document;
}

/** Refuse exporting a single excluded reference instead of creating a blank file. */
export function assertArtworkExportAllowed(node: SceneNode): void {
  if (isExcludedReference(node)) throw new Error(REFERENCE_EXPORT_REFUSAL);
}

/** Apply the same reference policy to every subtree-based artwork format. */
export function prepareArtworkExport(
  node: SceneNode,
  document: Document,
): { node: SceneNode; document: Document } {
  assertArtworkExportAllowed(node);
  const filteredDocument = documentForArtworkExport(document);
  return {
    node: filteredDocument.nodes[node.id] ?? node,
    document: filteredDocument,
  };
}
