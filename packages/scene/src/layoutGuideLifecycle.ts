import type { Document } from './document';
import type { LayoutGrid } from './gridTypes';
import type { NodeId } from './types';

/**
 * Copy keyed frame layouts alongside a cloned node subtree. Layout guides are
 * document metadata rather than node fields, so every clone path must call
 * this helper explicitly after obtaining its node ID map.
 */
export function cloneLayoutGuidesForIdMap(
  doc: Document,
  idMap: ReadonlyMap<NodeId, NodeId>,
): Document {
  const source = doc.gridSettings?.layoutGrids;
  if (!source) return doc;
  const copied: Record<NodeId, LayoutGrid[]> = { ...(source as Record<NodeId, LayoutGrid[]>) };
  let changed = false;
  for (const [oldId, newId] of idMap) {
    const guides = source[oldId];
    if (!guides || !Array.isArray(guides) || guides.length === 0) continue;
    copied[newId] = guides.map((guide, index) => ({
      ...guide,
      id: `${newId}:layout:${index + 1}`,
      frameId: newId,
      name: guide.name ? `${guide.name} copy` : undefined,
      margin: [...guide.margin] as [number, number, number, number],
      ...(guide.margins ? { margins: { ...guide.margins } } : {}),
    }));
    changed = true;
  }
  if (!changed) return doc;
  return {
    ...doc,
    gridSettings: {
      ...(doc.gridSettings ?? {}),
      layoutGrids: copied,
    },
  };
}

/** Remove keyed layouts whose owning frames no longer exist. */
export function pruneOrphanedLayoutGuides(doc: Document): Document {
  const source = doc.gridSettings?.layoutGrids;
  if (!source) return doc;
  const layoutGrids = Object.fromEntries(
    Object.entries(source).filter(([frameId, guides]) => {
      const node = doc.nodes[frameId];
      return node?.kind === 'frame' && Array.isArray(guides) && guides.length > 0;
    }),
  );
  if (Object.keys(layoutGrids).length === Object.keys(source).length) return doc;
  return {
    ...doc,
    gridSettings: {
      ...(doc.gridSettings ?? {}),
      layoutGrids: Object.keys(layoutGrids).length > 0 ? layoutGrids : undefined,
    },
  };
}
