/**
 * Design Canvas operations.
 *
 * Design Canvases are unbounded organizational surfaces for Design workspace
 * work. They intentionally do not share publishing Page geometry, masters,
 * spreads, or export selection semantics. Each canvas owns a transparent root
 * group, which lets the renderer, hit testing, and layer tree isolate one
 * canvas without inventing a second document model.
 */

import { generateKeyBetween } from '@varve/shared';
import { deepCloneSubtree } from './clone';
import type { Document } from './document';
import { removeNode } from './document-nodes';
import { cryptoId, devValidate, makeGroupNode } from './document-utils';
import { nextNodeId } from './node-id';
import type { DesignCanvas, GroupNode, NodeId } from './types';

export interface CreateDesignCanvasOptions {
  name?: string;
  /** Defaults to true, making the newly created canvas immediately editable. */
  activate?: boolean;
}

export type DeleteDesignCanvasPolicy = 'delete-content' | 'move-to-canvas' | 'move-to-pasteboard';

function nextDesignCanvasName(doc: Document): string {
  return `Canvas ${(doc.designCanvases?.length ?? 0) + 1}`;
}

function nextCanvasOrder(doc: Document): string {
  const canvases = doc.designCanvases ?? [];
  return generateKeyBetween(canvases.at(-1)?.order ?? null, null);
}

/** Return one canvas by id. */
export function getDesignCanvas(
  doc: Document,
  canvasId: NodeId | null | undefined,
): DesignCanvas | null {
  if (!canvasId) return null;
  return doc.designCanvases?.find((canvas) => canvas.id === canvasId) ?? null;
}

/** Return the selected canvas, falling back to the first persisted canvas. */
export function getActiveDesignCanvas(doc: Document): DesignCanvas | null {
  return getDesignCanvas(doc, doc.activeDesignCanvasId) ?? doc.designCanvases?.[0] ?? null;
}

/** Resolve the transparent content root for a selected or active canvas. */
export function designCanvasContentRoot(doc: Document, canvasId?: NodeId | null): NodeId | null {
  const canvas =
    canvasId === undefined ? getActiveDesignCanvas(doc) : getDesignCanvas(doc, canvasId);
  return canvas?.contentRoot ?? null;
}

/** Direct scene children for a selected or active Design Canvas. */
export function designCanvasChildren(doc: Document, canvasId?: NodeId | null): NodeId[] {
  const rootId = designCanvasContentRoot(doc, canvasId);
  if (!rootId) return [];
  const root = doc.nodes[rootId];
  return root?.kind === 'group' ? [...root.children] : [];
}

/** Create an empty unbounded Design Canvas and its transparent root group. */
export function createDesignCanvas(
  doc: Document,
  options: CreateDesignCanvasOptions = {},
): Document {
  const name = options.name?.trim() || nextDesignCanvasName(doc);
  const { id: contentRootId, doc: d1 } = nextNodeId(doc);
  const contentRoot = makeGroupNode(contentRootId, {
    name: `${name} content`,
    children: [],
  });
  const canvas: DesignCanvas = {
    id: cryptoId(),
    name,
    order: nextCanvasOrder(doc),
    contentRoot: contentRootId,
  };
  const next: Document = {
    ...d1,
    designCanvases: [...(d1.designCanvases ?? []), canvas],
    activeDesignCanvasId: options.activate === false ? d1.activeDesignCanvasId : canvas.id,
    rootChildren: [...d1.rootChildren, contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  };
  devValidate(next);
  return next;
}

/** Select a Design Canvas. Invalid ids leave the document unchanged. */
export function setActiveDesignCanvas(doc: Document, canvasId: NodeId): Document {
  if (!getDesignCanvas(doc, canvasId)) return doc;
  return { ...doc, activeDesignCanvasId: canvasId };
}

/** Rename a canvas without touching its content or order. */
export function renameDesignCanvas(doc: Document, canvasId: NodeId, name: string): Document {
  const nextName = name.trim();
  if (!nextName || !doc.designCanvases) return doc;
  const canvas = getDesignCanvas(doc, canvasId);
  if (!canvas || canvas.name === nextName) return doc;
  const root = doc.nodes[canvas.contentRoot];
  return {
    ...doc,
    designCanvases: doc.designCanvases.map((candidate) =>
      candidate.id === canvasId ? { ...candidate, name: nextName } : candidate,
    ),
    nodes:
      root?.kind === 'group'
        ? { ...doc.nodes, [root.id]: { ...root, name: `${nextName} content` } }
        : doc.nodes,
  };
}

/** Reorder canvases to the exact supplied canvas-id sequence. */
export function reorderDesignCanvases(doc: Document, canvasIds: NodeId[]): Document {
  const canvases = doc.designCanvases;
  if (!canvases || canvasIds.length !== canvases.length) return doc;
  const byId = new Map(canvases.map((canvas) => [canvas.id, canvas]));
  if (canvasIds.some((id) => !byId.has(id)) || new Set(canvasIds).size !== canvasIds.length) {
    return doc;
  }
  let previousOrder: string | null = null;
  const ordered = canvasIds.map((id) => {
    const order = generateKeyBetween(previousOrder, null);
    previousOrder = order;
    return { ...byId.get(id)!, order };
  });
  return { ...doc, designCanvases: ordered };
}

/** Duplicate an entire canvas subtree immediately after the source canvas. */
export function duplicateDesignCanvas(doc: Document, canvasId: NodeId): Document {
  const source = getDesignCanvas(doc, canvasId);
  const sourceRoot = source ? (doc.nodes[source.contentRoot] as GroupNode | undefined) : undefined;
  if (!source || !sourceRoot || sourceRoot.kind !== 'group') return doc;

  const clone = deepCloneSubtree(doc.nodes, doc.nextId, source.contentRoot);
  const clonedRoot = clone.nodes[clone.rootId] as GroupNode | undefined;
  if (clonedRoot?.kind !== 'group') return doc;

  const sourceIndex = doc.designCanvases?.findIndex((canvas) => canvas.id === source.id) ?? -1;
  const successor = sourceIndex >= 0 ? doc.designCanvases?.[sourceIndex + 1] : undefined;
  const copyName = `${source.name} copy`;
  const canvas: DesignCanvas = {
    id: cryptoId(),
    name: copyName,
    order: generateKeyBetween(source.order, successor?.order ?? null),
    contentRoot: clone.rootId,
  };
  const canvases = [...(doc.designCanvases ?? [])];
  canvases.splice(Math.max(0, sourceIndex + 1), 0, canvas);
  const rootIndex = doc.rootChildren.indexOf(source.contentRoot);
  const rootChildren = [...doc.rootChildren];
  rootChildren.splice(rootIndex >= 0 ? rootIndex + 1 : rootChildren.length, 0, clone.rootId);
  const next: Document = {
    ...doc,
    nextId: clone.nextId,
    designCanvases: canvases,
    activeDesignCanvasId: canvas.id,
    rootChildren,
    nodes: {
      ...doc.nodes,
      ...clone.nodes,
      [clone.rootId]: { ...clonedRoot, name: `${copyName} content` },
    },
  };
  devValidate(next);
  return next;
}

/**
 * Delete a Design Canvas under an explicit content policy. Moving content
 * preserves authored transforms because canvas roots are transparent groups at
 * the world origin. Invalid canvas targets safely degrade to pasteboard move.
 */
export function deleteDesignCanvas(
  doc: Document,
  canvasId: NodeId,
  policy: DeleteDesignCanvasPolicy = 'delete-content',
  targetCanvasId?: NodeId,
): Document {
  const source = getDesignCanvas(doc, canvasId);
  if (!source || !doc.designCanvases) return doc;
  const sourceRoot = doc.nodes[source.contentRoot] as GroupNode | undefined;
  const remaining = doc.designCanvases.filter((canvas) => canvas.id !== canvasId);
  const activeStillExists = remaining.some((canvas) => canvas.id === doc.activeDesignCanvasId);
  const fallback = remaining[0];
  let next: Document = {
    ...doc,
    designCanvases: remaining,
    activeDesignCanvasId: activeStillExists ? doc.activeDesignCanvasId : fallback?.id,
  };

  const children = sourceRoot?.kind === 'group' ? sourceRoot.children : [];
  const target =
    policy === 'move-to-canvas'
      ? remaining.find((canvas) => canvas.id === targetCanvasId)
      : undefined;
  const targetRoot = target ? (next.nodes[target.contentRoot] as GroupNode | undefined) : undefined;
  const moveToPasteboard =
    policy === 'move-to-pasteboard' ||
    (policy === 'move-to-canvas' && targetRoot?.kind !== 'group');
  if (moveToPasteboard) {
    const sourceRootIndex = next.rootChildren.indexOf(source.contentRoot);
    const rootChildren = [...next.rootChildren];
    rootChildren.splice(
      sourceRootIndex >= 0 ? sourceRootIndex + 1 : rootChildren.length,
      0,
      ...children,
    );
    next = { ...next, rootChildren };
  } else if (target && targetRoot?.kind === 'group' && children.length > 0) {
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [target.contentRoot]: { ...targetRoot, children: [...targetRoot.children, ...children] },
      },
    };
  }

  // Remove only the empty source root after moved children have been detached.
  if (policy !== 'delete-content' && sourceRoot?.kind === 'group') {
    next = {
      ...next,
      nodes: { ...next.nodes, [source.contentRoot]: { ...sourceRoot, children: [] } },
    };
  }
  next = removeNode(next, source.contentRoot);
  devValidate(next);
  return next;
}
