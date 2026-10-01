/**
 * Editor surface projection contract.
 *
 * The document graph is intentionally wider than the scene a user is
 * currently looking at: it may contain several Design Canvases, publishing
 * pages, master sources, and storage roots. Consumers that describe or act on
 * the current canvas must start from this projection instead of traversing
 * `rootChildren` or `doc.nodes` directly.
 *
 * This module is scene-only and pure. It reuses the same occurrence resolver
 * as the renderer, so a master source projected onto multiple pages retains a
 * qualified instance identity rather than collapsing to its authored node id.
 */

import { getActiveDesignCanvas, getDesignCanvas } from './designCanvas';
import type { Document } from './document';
import { documentsDifferOnlyInTransforms } from './nodeChanges';
import {
  type MultipageNodeInstance,
  type MultipageSceneOptions,
  multipageNodeInstances,
  publishingPagesInViewport,
} from './pageScene';
import type { NodeId } from './types';
import { applySoloToDocument } from './visibility';

export type BaseEditorSurface =
  | { kind: 'designCanvas'; designCanvasId: NodeId }
  | {
      kind: 'publishing';
      membership: 'allPlacedPages' | 'activePage';
      /** Focus metadata only when membership is allPlacedPages. */
      activePageId: NodeId | null;
    }
  | { kind: 'masterSource'; masterId: NodeId }
  | { kind: 'legacyFlatPasteboard' };

export interface QualifiedOccurrenceTarget {
  surfaceKey: string;
  instanceId: string;
  nodeId: NodeId;
}

export interface EditorSurfaceContext {
  base: BaseEditorSurface;
  isolationRoot: QualifiedOccurrenceTarget | null;
  /** Workspace is intentionally a string here to keep scene independent of editor UI types. */
  workspaceMode: string;
}

export interface EditorSceneScopeOptions {
  workspaceMode: string;
  activePageId?: NodeId | null;
  activeDesignCanvasId?: NodeId | null;
  masterEditId?: NodeId | null;
  isolatedNodeId?: NodeId | null;
  viewportWorldRect?: MultipageSceneOptions['viewportWorldRect'];
}

export interface ResolvedEditorSceneScope {
  surfaceKey: string;
  context: EditorSurfaceContext;
  occurrences: readonly MultipageNodeInstance[];
  interactiveOccurrenceIds: ReadonlySet<string>;
  authoredNodeIds: ReadonlySet<NodeId>;
}

function firstCanvasId(doc: Document, requested: NodeId | null | undefined): NodeId | null {
  const requestedCanvas = requested ? getDesignCanvas(doc, requested) : null;
  if (requestedCanvas) return requestedCanvas.id;

  // A supplied id is stale or malformed: choose the first persisted canvas,
  // rather than allowing an unrelated active id to decide the recovery target.
  if (requested !== undefined) return doc.designCanvases?.[0]?.id ?? null;

  const active = getActiveDesignCanvas(doc);
  if (active) return active.id;

  return doc.designCanvases?.[0]?.id ?? null;
}

function resolveBaseSurface(doc: Document, options: EditorSceneScopeOptions): BaseEditorSurface {
  if (options.masterEditId && doc.masters?.[options.masterEditId]) {
    return { kind: 'masterSource', masterId: options.masterEditId };
  }

  const comicPageWorkflow = options.workspaceMode === 'drawing' && Boolean(doc.workflowProfile);
  if (
    !comicPageWorkflow &&
    options.workspaceMode !== 'print' &&
    (doc.designCanvases?.length ?? 0) > 0
  ) {
    // An invalid/stale active id must never fall through to publishing pages or
    // every root child. Prefer the first explicitly allowed canvas instead.
    return {
      kind: 'designCanvas',
      designCanvasId: firstCanvasId(doc, options.activeDesignCanvasId) ?? '',
    };
  }

  if (doc.pages?.length || options.workspaceMode === 'print') {
    return {
      kind: 'publishing',
      membership: 'allPlacedPages',
      activePageId: options.activePageId ?? null,
    };
  }

  return { kind: 'legacyFlatPasteboard' };
}

function surfaceKeyFor(base: BaseEditorSurface): string {
  switch (base.kind) {
    case 'designCanvas':
      return `designCanvas:${base.designCanvasId}`;
    case 'publishing':
      return `publishing:${base.membership}`;
    case 'masterSource':
      return `master:${base.masterId}`;
    case 'legacyFlatPasteboard':
      return 'legacyFlatPasteboard';
  }
}

function instanceParentId(entry: MultipageNodeInstance): string | null {
  if (!entry.parentId) return null;
  return entry.instancePrefix ? `${entry.instancePrefix}:${entry.parentId}` : entry.parentId;
}

function occurrenceIsDescendantOf(
  instanceId: string,
  rootInstanceId: string,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  let current: string | null = instanceId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === rootInstanceId) return true;
    visited.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

function visibleInOccurrence(
  entry: MultipageNodeInstance,
  effectiveDoc: Document,
  parents: ReadonlyMap<string, string | null>,
  byInstance: ReadonlyMap<string, MultipageNodeInstance>,
): boolean {
  let current: string | null = entry.instanceId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const occurrence = byInstance.get(current);
    const node = occurrence ? effectiveDoc.nodes[occurrence.nodeId] : undefined;
    if (!node || node.visible === false) return false;
    current = parents.get(current) ?? null;
  }
  return true;
}

/**
 * Resolve the exact scene visible/editable on the current editor surface.
 *
 * The returned occurrence list is already safe for labels, accessibility,
 * minimaps, hit-test candidates, and renderer inputs. It excludes metadata
 * content roots because `multipageNodeInstances` starts at their authored
 * children. Invalid roots and malformed/cyclic child graphs degrade to an
 * empty scope through the cycle-safe occurrence walk.
 */
export function resolveEditorSceneScope(
  doc: Document,
  options: EditorSceneScopeOptions,
): ResolvedEditorSceneScope {
  const base = resolveBaseSurface(doc, options);
  const key = sceneScopeKey(doc, base, options);
  const index = sceneScopeCache.findIndex((entry) => entry.doc === doc && entry.key === key);
  if (index >= 0) {
    const entry = sceneScopeCache[index]!;
    if (index > 0) {
      sceneScopeCache.splice(index, 1);
      sceneScopeCache.unshift(entry);
    }
    return entry.scope;
  }
  const scope = reusableScope(doc, base, key) ?? computeEditorSceneScope(doc, options, base);
  sceneScopeCache.unshift({ doc, key, scope });
  if (sceneScopeCache.length > SCENE_SCOPE_CACHE_CAPACITY) sceneScopeCache.pop();
  return scope;
}

/**
 * A cached scope still valid for `doc`: one resolved with the same options
 * for a document that differs from `doc` only in node transforms. Every drag
 * frame commits such a document, and recomputing walked the whole scene per
 * pointer move for snapping, the renderer, and overlays alike.
 *
 * The scope reads structure, visibility, solo, pages, canvases, and masters,
 * never node transforms, except when a publishing surface culls placed pages
 * by the viewport; that case is not reused.
 */
function reusableScope(
  doc: Document,
  base: BaseEditorSurface,
  key: string,
): ResolvedEditorSceneScope | null {
  if (base.kind === 'publishing' && (doc.pages?.length ?? 0) > 0) return null;
  const previous = sceneScopeCache.find((entry) => entry.key === key);
  if (!previous || !documentsDifferOnlyInTransforms(previous.doc, doc)) return null;
  return previous.scope;
}

/**
 * The renderer, snapping, overlays, and the minimap each resolve the scope
 * for the same committed document within one frame, and each resolution
 * walks the whole scene. The result is a pure, read-only function of the
 * (immutable) document and these options, so recent answers are shared. The
 * cache is small because undo history keeps old documents alive.
 */
const SCENE_SCOPE_CACHE_CAPACITY = 6;
const sceneScopeCache: Array<{ doc: Document; key: string; scope: ResolvedEditorSceneScope }> = [];

function optionPart(value: string | null | undefined): string {
  return value === undefined ? '\u0001' : value === null ? '\u0000' : value;
}

function sceneScopeKey(
  doc: Document,
  base: BaseEditorSurface,
  options: EditorSceneScopeOptions,
): string {
  // The viewport only culls placed pages on a publishing surface. Design
  // canvases, master sources, and page-less pasteboards never read it, so
  // camera motion must not defeat the cache there (it did on every pan).
  const viewportCulls = base.kind === 'publishing' && (doc.pages?.length ?? 0) > 0;
  const rect = viewportCulls ? options.viewportWorldRect : undefined;
  // Culling only chooses which placed pages contribute, so a pan that keeps
  // the same pages in view shares one resolution.
  const rectPart =
    rect === undefined
      ? '\u0001'
      : rect === null
        ? '\u0000'
        : `pages:${publishingPagesInViewport(doc, rect).join(',')}`;
  return [
    options.workspaceMode,
    optionPart(options.activePageId),
    optionPart(options.activeDesignCanvasId),
    optionPart(options.masterEditId),
    optionPart(options.isolatedNodeId),
    rectPart,
  ].join('|');
}

function computeEditorSceneScope(
  doc: Document,
  options: EditorSceneScopeOptions,
  base: BaseEditorSurface,
): ResolvedEditorSceneScope {
  const surfaceKey = surfaceKeyFor(base);
  const context: EditorSurfaceContext = {
    base,
    isolationRoot: null,
    workspaceMode: options.workspaceMode,
  };

  const multipageOptions: MultipageSceneOptions = {
    viewportWorldRect: options.viewportWorldRect,
    ...(base.kind === 'masterSource'
      ? { masterEditId: base.masterId }
      : base.kind === 'designCanvas'
        ? { designCanvasId: base.designCanvasId }
        : { designCanvasId: null }),
  };
  const allOccurrences =
    base.kind === 'designCanvas' &&
    (!base.designCanvasId ||
      !getDesignCanvas(doc, base.designCanvasId) ||
      doc.nodes[getDesignCanvas(doc, base.designCanvasId)?.contentRoot ?? '']?.kind !== 'group')
      ? []
      : multipageNodeInstances(doc, multipageOptions);
  const byInstance = new Map(allOccurrences.map((entry) => [entry.instanceId, entry]));
  const parents = new Map<string, string | null>();
  for (const entry of allOccurrences) parents.set(entry.instanceId, instanceParentId(entry));

  const requestedIsolation = options.isolatedNodeId
    ? allOccurrences.find((entry) => entry.nodeId === options.isolatedNodeId)
    : undefined;
  const isolationRoot = requestedIsolation
    ? {
        surfaceKey,
        instanceId: requestedIsolation.instanceId,
        nodeId: requestedIsolation.nodeId,
      }
    : null;
  context.isolationRoot = isolationRoot;

  const effectiveDoc = applySoloToDocument(doc);
  const scoped = allOccurrences.filter((entry) => {
    if (
      isolationRoot &&
      !occurrenceIsDescendantOf(entry.instanceId, isolationRoot.instanceId, parents)
    ) {
      return false;
    }
    return visibleInOccurrence(entry, effectiveDoc, parents, byInstance);
  });

  // Re-root an isolated subtree for consumers that use parentId/depth to
  // determine logical top-level status. Physical transforms still come from
  // the document graph, but the storage parent is outside this surface.
  const scopedIds = new Set(scoped.map((entry) => entry.instanceId));
  const occurrences = scoped.map((entry) => {
    const parent = instanceParentId(entry);
    let depth = 0;
    let current = parent;
    const visited = new Set<string>();
    while (current && scopedIds.has(current) && !visited.has(current)) {
      visited.add(current);
      depth += 1;
      current = parents.get(current) ?? null;
    }
    if (entry.instanceId === isolationRoot?.instanceId) {
      return { ...entry, parentId: null, depth: 0 };
    }
    return { ...entry, depth };
  });

  return {
    surfaceKey,
    context,
    occurrences,
    interactiveOccurrenceIds: new Set(occurrences.map((entry) => entry.instanceId)),
    authoredNodeIds: new Set(occurrences.map((entry) => entry.nodeId)),
  };
}

/** Development-only guard for overlay producers. */
export function assertOccurrencesInScope(
  scope: ResolvedEditorSceneScope,
  emittedOccurrenceIds: readonly string[],
): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;
  for (const occurrenceId of emittedOccurrenceIds) {
    if (!scope.interactiveOccurrenceIds.has(occurrenceId)) {
      throw new Error(
        `[Varve] label occurrence ${occurrenceId} is outside resolved surface ${scope.surfaceKey}`,
      );
    }
  }
}
