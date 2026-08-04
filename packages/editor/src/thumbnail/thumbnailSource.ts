/**
 * Thumbnail source resolution — maps user intent (page, frame, selection)
 * to a flat array of engine SceneNodes with pre-computed world transforms.
 *
 * This is the high-level counterpart to the engine's `generateThumbnail()`,
 * which only renders what it's given.
 */

import type { Affine, SceneNode, ThumbnailResult, UnifiedThumbnailOptions } from '@varve/engine';
import { generateThumbnail } from '@varve/engine';
import { contentHash } from '@varve/platform';
import type { Document, NodeId } from '@varve/scene';
import { activePageNodes, getChildren } from '@varve/scene';
import { multiplyAffine } from '@varve/shared';

// ─── Source types ──────────────────────────────────────────────────────

export type ThumbnailSourceType =
  | { type: 'document' }
  | { type: 'page'; pageId: string }
  | { type: 'frame'; nodeId: string }
  | { type: 'selection'; nodeIds: string[] };

export function sourceLabel(s: ThumbnailSourceType): string {
  switch (s.type) {
    case 'document':
      return 'Document overview';
    case 'page':
      return 'Current page';
    case 'frame':
      return 'Selected frame';
    case 'selection':
      return 'Selection';
  }
}

// ─── Node resolution ──────────────────────────────────────────────────

function resolveNodeIds(doc: Document, source: ThumbnailSourceType): NodeId[] {
  switch (source.type) {
    case 'document':
      return activePageNodes(doc);
    case 'page': {
      const globals = doc.globalChildren ?? [];
      const page = doc.pages?.find((p) => p.id === source.pageId);
      if (!page) return activePageNodes(doc);
      const contentRoot = doc.nodes[page.contentRoot];
      const children = contentRoot && 'children' in contentRoot ? (contentRoot.children ?? []) : [];
      return [...globals, ...children];
    }
    case 'frame': {
      const node = doc.nodes[source.nodeId];
      if (!node) return [];
      const children = getChildren(doc, source.nodeId);
      if (children) {
        return [source.nodeId, ...children];
      }
      return [source.nodeId];
    }
    case 'selection':
      return source.nodeIds.filter((id) => id in doc.nodes);
  }
}

// ─── World transform resolution ───────────────────────────────────────

function buildParentMap(doc: Document): Map<NodeId, NodeId> {
  const parents = new Map<NodeId, NodeId>();
  for (const node of Object.values(doc.nodes)) {
    const children = 'children' in node ? (node.children ?? []) : [];
    for (const c of children) parents.set(c, node.id);
  }
  return parents;
}

function resolveWorldTransform(
  id: NodeId,
  doc: Document,
  parents: Map<NodeId, NodeId>,
  cache: Map<NodeId, Affine>,
  stack: Set<NodeId>,
): Affine {
  const cached = cache.get(id);
  if (cached) return cached;
  if (stack.has(id)) return [1, 0, 0, 1, 0, 0];
  stack.add(id);

  const node = doc.nodes[id];
  const local: Affine = node?.transform ?? [1, 0, 0, 1, 0, 0];
  const parentId = parents.get(id);
  const world = parentId
    ? multiplyAffine(resolveWorldTransform(parentId, doc, parents, cache, stack), local)
    : local;
  cache.set(id, world);
  return world;
}

// ─── Build engine SceneNode array from doc ────────────────────────────

/** Extract scene-node fields relevant to the engine's IR pipeline. */
function toEngineNode(node: import('@varve/scene').SceneNode, transform: Affine): SceneNode {
  const base = {
    id: node.id,
    name: node.name,
    transform,
    opacity: node.opacity,
    blendMode: node.blendMode,
    fills: node.fills,
    strokes: 'strokes' in node ? node.strokes : undefined,
    effects: 'effects' in node ? node.effects : undefined,
  };

  if (node.kind === 'shape') {
    const s = node as import('@varve/scene').ShapeNode;
    return {
      ...base,
      kind: 'shape',
      shape: s.shape,
      fill: s.fill,
    } as unknown as SceneNode;
  }

  if (node.kind === 'text') {
    const t = node as import('@varve/scene').TextNode;
    return {
      ...base,
      kind: 'text',
      text: t.text ?? '',
      w: t.w,
      h: t.h,
      fontSize: t.fontSize ?? 16,
      fontFamily: t.fontFamily,
      fontWeight: t.fontWeight ?? 400,
      fontStyle: t.fontStyle ?? 'normal',
      fill: t.fill,
    } as unknown as SceneNode;
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const w = 'w' in node ? node.w : undefined;
    const h = 'h' in node ? node.h : undefined;
    if (w !== undefined && h !== undefined) {
      return {
        ...base,
        kind: 'frame',
        shape: { kind: 'rect' as const, x: 0, y: 0, w, h },
        fill: 'fill' in node ? node.fill : undefined,
      } as unknown as SceneNode;
    }
  }

  // Fallback: render as rect if shape info available
  const shape = 'shape' in node ? node.shape : undefined;
  if (shape) {
    return {
      ...base,
      kind: 'shape',
      shape,
      fill: 'fill' in node ? node.fill : undefined,
    } as unknown as SceneNode;
  }

  // Skip unknown node types
  return null as unknown as SceneNode;
}

function buildEngineNodes(doc: Document, nodeIds: NodeId[]): SceneNode[] {
  const parents = buildParentMap(doc);
  const worldCache = new Map<NodeId, Affine>();
  const engineNodes: SceneNode[] = [];

  for (const id of nodeIds) {
    const node = doc.nodes[id];
    if (!node) continue;
    if ('visible' in node && node.visible === false) continue;

    const transform = resolveWorldTransform(id, doc, parents, worldCache, new Set());
    const engineNode = toEngineNode(node, transform);
    if (engineNode) {
      engineNodes.push(engineNode);
    }
  }

  return engineNodes;
}

// ─── High-level API ───────────────────────────────────────────────────

export interface GenerateDocThumbnailOptions extends UnifiedThumbnailOptions {
  source?: ThumbnailSourceType;
}

/**
 * Generate a thumbnail for a scene Document.
 *
 * Resolves the source (page, frame, selection, or full document), builds
 * engine SceneNodes with world transforms, and renders via the engine's
 * thumbnail pipeline.
 */
export async function generateDocThumbnail(
  doc: Document,
  options: GenerateDocThumbnailOptions = {},
  signal?: AbortSignal,
): Promise<ThumbnailResult | null> {
  const source: ThumbnailSourceType = options.source ?? { type: 'document' };
  const nodeIds = resolveNodeIds(doc, source);
  if (nodeIds.length === 0) return null;

  if (signal?.aborted) return null;

  const engineNodes = buildEngineNodes(doc, nodeIds);
  if (engineNodes.length === 0) return null;

  const revisionId = contentHash(JSON.stringify(doc));

  const { source: _source, ...engineOpts } = options as GenerateDocThumbnailOptions;
  return generateThumbnail(
    engineNodes,
    revisionId,
    {
      ...engineOpts,
      sourceLabel: sourceLabel(source),
    },
    signal,
  );
}
