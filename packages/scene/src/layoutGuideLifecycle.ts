import type { LayoutGrid } from './gridTypes';
import type { NodeId } from './types';

type GuideLayoutDocument = {
  nodes: Record<NodeId, { kind?: string }>;
  gridSettings?: { layoutGrids?: Record<NodeId, LayoutGrid[]> };
};

/**
 * Copy keyed frame layouts alongside a cloned node subtree. Layout guides are
 * document metadata rather than node fields, so every clone path must call
 * this helper explicitly after obtaining its node ID map.
 */
export function cloneLayoutGuidesForIdMap<T extends GuideLayoutDocument>(
  doc: T,
  idMap: ReadonlyMap<NodeId, NodeId>,
): T {
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
  } as T;
}

/** Import a v3 clipboard guide table while remapping only owners in the fragment. */
export function remapLayoutGuidesForIdMap<T extends GuideLayoutDocument>(
  doc: T,
  source: Readonly<Record<NodeId, LayoutGrid[]>> | undefined,
  idMap: ReadonlyMap<NodeId, NodeId>,
): T {
  if (!source) return doc;
  const layoutGrids = { ...(doc.gridSettings?.layoutGrids ?? {}) };
  let changed = false;
  for (const [oldId, newId] of idMap) {
    const guides = source[oldId];
    if (!guides || guides.length === 0) continue;
    layoutGrids[newId] = guides.slice(0, 32).map((guide, index) => ({
      ...guide,
      id: `${newId}:layout:${index + 1}`,
      frameId: newId,
      margin: [...guide.margin] as [number, number, number, number],
      ...(guide.margins ? { margins: { ...guide.margins } } : {}),
    }));
    changed = true;
  }
  return changed
    ? ({ ...doc, gridSettings: { ...(doc.gridSettings ?? {}), layoutGrids } } as T)
    : doc;
}

/** Remove keyed layouts whose owning frames no longer exist. */
export function pruneOrphanedLayoutGuides<T extends GuideLayoutDocument>(doc: T): T {
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
  } as T;
}
