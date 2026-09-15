/**
 * v2.21 → v2.22 migration: persisted Design Canvases.
 *
 * Earlier flat documents used rootChildren directly for unbounded design
 * content. Preserve that artwork by placing it under one transparent
 * `Canvas 1` root. Publishing documents already carrying Pages are left
 * untouched: their root/pasteboard content must retain page-layout semantics
 * and is never silently reclassified as Design Canvas content.
 */

import { makeGroupNode } from './document-utils';
import type { NodeId } from './types';

function nextFreeNodeId(
  nodes: Record<string, unknown>,
  nextId: number,
): { id: string; nextId: number } {
  let counter = Math.max(1, Number.isFinite(nextId) ? Math.floor(nextId) : 1);
  let id = `n${counter}`;
  while (nodes[id]) {
    counter += 1;
    id = `n${counter}`;
  }
  return { id, nextId: counter + 1 };
}

export function migrateV221ToV222(raw: Record<string, unknown>): Record<string, unknown> {
  const existingCanvases = raw.designCanvases;
  if (Array.isArray(existingCanvases)) {
    return { ...raw, formatVersion: '2.22' };
  }

  const pages = raw.pages;
  if (Array.isArray(pages) && pages.length > 0) {
    return { ...raw, formatVersion: '2.22' };
  }

  const rawNodes = (raw.nodes ?? {}) as Record<string, unknown>;
  const rootChildren = Array.isArray(raw.rootChildren)
    ? raw.rootChildren.filter((id): id is string => typeof id === 'string')
    : [];
  const globalChildren = new Set(
    Array.isArray(raw.globalChildren)
      ? raw.globalChildren.filter((id): id is string => typeof id === 'string')
      : [],
  );
  const masters =
    raw.masters && typeof raw.masters === 'object'
      ? (raw.masters as Record<string, { contentRoot?: unknown }>)
      : {};
  const masterRoots = new Set(
    Object.values(masters)
      .map((master) => master.contentRoot)
      .filter((id): id is string => typeof id === 'string'),
  );
  const canvasChildren = rootChildren.filter(
    (id) => !globalChildren.has(id) && !masterRoots.has(id),
  );
  const allocation = nextFreeNodeId(rawNodes, typeof raw.nextId === 'number' ? raw.nextId : 1);
  const nodes = {
    ...rawNodes,
    [allocation.id]: makeGroupNode(allocation.id as NodeId, {
      name: 'Canvas 1 content',
      children: canvasChildren as NodeId[],
    }),
  };
  const canvasId = `canvas-${allocation.id}`;

  return {
    ...raw,
    formatVersion: '2.22',
    nextId: allocation.nextId,
    nodes,
    rootChildren: [allocation.id],
    designCanvases: [
      {
        id: canvasId,
        name: 'Canvas 1',
        order: 'a0',
        contentRoot: allocation.id,
      },
    ],
    activeDesignCanvasId: canvasId,
  };
}
