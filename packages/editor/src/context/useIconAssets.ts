/**
 * Icon asset operations — insert, replace, and detach document icon assets.
 *
 * Follows the paste/import pattern: the sanitized SVG is converted to scene
 * nodes via the @varve/import pipeline, the subtree is merged into the live
 * document in a single undo transaction, and provenance (provider, licence,
 * attribution) is recorded in `Document.iconAssets` keyed by a deterministic
 * asset id. Nodes reference the asset via `NodeBase.iconAssetId`.
 *
 * Portability: the sanitized vector data travels with the document, so a
 * provider outage, cache clear, or offline open can never break rendering.
 */

import { type SanitizeError, type Shape, sanitizeSvg } from '@varve/engine';
import { ImportService } from '@varve/import';
import {
  createDocumentIconAsset,
  type Document,
  type DocumentIconAsset,
  type IconVariantStyle,
  iconAssetIdFor,
  isIconAssetReferenced,
  type SceneNode,
} from '@varve/scene';
import { useCallback } from 'react';
import type { EditorState } from './types';

export interface IconInsertRequest {
  /** Human-readable icon name (provider name or pack name). */
  name: string;
  /** Provider id (e.g. "iconify"). */
  providerId?: string;
  /** Icon pack/prefix (e.g. "mdi", "lucide"). */
  prefix: string;
  /** Raw (untrusted) SVG payload. Sanitized before use. */
  svg: string;
  /** Licence name shown to the user. */
  licence?: string;
  /** Attribution text required by the licence. */
  attribution?: string;
  /** Icon style (outline/filled/...). */
  style?: IconVariantStyle;
  /** World-space position; defaults to viewport centre. */
  position?: { x: number; y: number };
}

export interface IconAssetsAPI {
  /**
   * Insert an icon into the active page. Sanitizes, converts to scene nodes,
   * records a document icon asset, and selects the inserted node.
   * Returns the new node id, or null on failure.
   */
  insertIconAsset: (request: IconInsertRequest) => Promise<NodeId | null>;
  /**
   * Replace one or more selected icon nodes with a new icon. The new icon is
   * placed at the first node's world bounds (scaled to fit, preserving
   * aspect), the old nodes are removed, and the replacement is selected.
   * Runs as a single undo transaction.
   */
  replaceIconAsset: (nodeIds: NodeId[], request: IconInsertRequest) => Promise<NodeId | null>;
  /**
   * Detach icon nodes into plain editable nodes by clearing their icon
   * provenance link. The visual content is unchanged.
   */
  detachIconNodes: (nodeIds: NodeId[]) => void;
  /** Look up a document icon asset by id. */
  getIconAsset: (assetId: string) => DocumentIconAsset | undefined;
  /** Look up the asset referenced by a node. */
  getIconAssetForNode: (nodeId: NodeId) => DocumentIconAsset | undefined;
}

type NodeId = string;

interface InsertSubtreeResult {
  doc: Document;
  rootId: string;
}

interface UseIconAssetsDeps {
  stateRef: React.MutableRefObject<EditorState>;
  updateDoc: (fn: (doc: Document) => Document) => void;
  patch: (partial: Partial<EditorState>) => void;
  announce: (message: string) => void;
  insertSubtree: (
    targetDoc: Document,
    sourceDoc: Document,
    rootId: string,
    adjustRoot: (node: SceneNode) => SceneNode,
  ) => InsertSubtreeResult | null;
  viewportCenterWorld: (cam: {
    zoom: number;
    pan: { x: number; y: number };
    cameraRotation: number;
  }) => { x: number; y: number };
}

function sanitizeIconSvg(svg: string): string | null {
  try {
    return sanitizeSvg(svg).svg;
  } catch (err) {
    const code = err instanceof Error ? ((err as SanitizeError).code ?? 'error') : 'error';
    if (typeof console !== 'undefined') {
      console.warn(`[icon] sanitize failed (${code})`, err);
    }
    return null;
  }
}

function extractViewBox(svg: string): string {
  const match = /viewBox="([^"]+)"/.exec(svg);
  if (match?.[1]) return match[1];
  const width = /width="([\d.]+)"/.exec(svg);
  const height = /height="([\d.]+)"/.exec(svg);
  if (width?.[1] && height?.[1]) return `0 0 ${width[1]} ${height[1]}`;
  return '0 0 24 24';
}

/** World-space bounds of a shape node (transform position + geometry extents). */
function nodeBoundsOf(node: SceneNode): { x: number; y: number; w: number; h: number } | null {
  if (node.kind !== 'shape') return null;
  const extents = shapeExtents(node.shape);
  if (!extents) return null;
  const t = node.transform;
  return { x: t[4], y: t[5], w: extents.w, h: extents.h };
}

/** Approximate width/height of a shape's local geometry (control-point bbox for paths). */
function shapeExtents(shape: Shape): { w: number; h: number } | null {
  switch (shape.kind) {
    case 'rect':
      return { w: shape.w, h: shape.h };
    case 'ellipse':
      return { w: shape.rx * 2, h: shape.ry * 2 };
    case 'circle':
      return { w: shape.r * 2, h: shape.r * 2 };
    case 'polygon':
      return { w: shape.radius * 2, h: shape.radius * 2 };
    case 'star':
      return { w: shape.outerRadius * 2, h: shape.outerRadius * 2 };
    case 'path': {
      if (shape.points.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of shape.points) {
        const xs = [p.x, p.handleIn?.[0] ?? p.x, p.handleOut?.[0] ?? p.x];
        const ys = [p.y, p.handleIn?.[1] ?? p.y, p.handleOut?.[1] ?? p.y];
        for (const v of xs) {
          if (v < minX) minX = v;
          if (v > maxX) maxX = v;
        }
        for (const v of ys) {
          if (v < minY) minY = v;
          if (v > maxY) maxY = v;
        }
      }
      return { w: maxX - minX, h: maxY - minY };
    }
    default:
      return null;
  }
}

/**
 * Apply a uniform scale around the node's origin (top-left) by scaling the
 * affine transform's scale factors. Position components stay fixed, so the
 * node's world top-left does not move. Works for every node kind.
 */
function scaleNodeAroundOrigin(node: SceneNode, scale: number): SceneNode {
  if (scale === 1 || node.kind !== 'shape') return node;
  const t = node.transform;
  return {
    ...node,
    transform: [t[0] * scale, t[1] * scale, t[2] * scale, t[3] * scale, t[4], t[5]],
  } as SceneNode;
}

/** Position a node's transform at a world point. */
function applyDropPosition(node: SceneNode, position: { x: number; y: number }): SceneNode {
  if (node.kind !== 'shape') return node;
  const t = node.transform;
  return {
    ...node,
    transform: [t[0], t[1], t[2], t[3], position.x, position.y],
  } as SceneNode;
}

/** Remove ids (and prune them from container children) in a pure doc update. */
function removeNodesPure(
  doc: Document,
  idsToRemove: Set<string>,
): { doc: Document; iconAssets?: Document['iconAssets'] } {
  const nodes: Record<string, SceneNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (idsToRemove.has(id)) continue;
    const children = (node as { children?: string[] }).children ?? [];
    if (children.some((c) => idsToRemove.has(c))) {
      nodes[id] = {
        ...node,
        children: children.filter((c) => !idsToRemove.has(c)),
      } as SceneNode;
    } else {
      nodes[id] = node;
    }
  }
  let iconAssets = doc.iconAssets;
  if (iconAssets) {
    const remaining = Object.fromEntries(
      Object.entries(iconAssets).filter(([id]) => isIconAssetReferenced({ nodes }, id)),
    );
    iconAssets = Object.keys(remaining).length > 0 ? remaining : undefined;
  }
  return {
    doc: {
      ...doc,
      nodes,
      rootChildren: doc.rootChildren.filter((id) => !idsToRemove.has(id)),
      iconAssets,
    },
  };
}

export function useIconAssets(deps: UseIconAssetsDeps): IconAssetsAPI {
  const { stateRef, updateDoc, patch, announce, insertSubtree, viewportCenterWorld } = deps;

  /** Convert sanitized SVG to scene nodes via the import pipeline. */
  const svgToDocument = useCallback(async (svg: string, name: string): Promise<Document | null> => {
    const input = {
      name: `${name}.svg`,
      source: 'asset-library' as const,
      size: new TextEncoder().encode(svg).byteLength,
      text: svg,
    };
    const report = await ImportService.importFiles([input], { center: false });
    const artifact = report?.files[0]?.artifacts[0];
    if (!artifact || artifact.nodeIds.length === 0) return null;
    return artifact.document;
  }, []);

  /**
   * Core insertion: pure computation of the next document state. Returns the
   * new root id, or null when nothing can be inserted.
   */
  const computeInsertion = useCallback(
    (
      request: IconInsertRequest,
      sanitized: string,
      sourceDoc: Document,
    ): { doc: Document; rootId: string; asset: DocumentIconAsset } | null => {
      const doc = stateRef.current.document;
      const target =
        request.position ??
        viewportCenterWorld({
          zoom: stateRef.current.zoom,
          pan: stateRef.current.pan,
          cameraRotation: stateRef.current.cameraRotation,
        });
      const inserted = insertSubtree(doc, sourceDoc, sourceDoc.rootChildren[0]!, (node) =>
        applyDropPosition(node, target),
      );
      if (!inserted) return null;
      const rootNode = inserted.doc.nodes[inserted.rootId];
      if (!rootNode) return null;

      const asset = createDocumentIconAsset(request.name, request.prefix, sanitized, {
        providerId: request.providerId,
        style: request.style ?? 'outline',
        licence: request.licence,
        attribution: request.attribution,
        viewBox: extractViewBox(sanitized),
      });
      asset.id = iconAssetIdFor(request.prefix, asset.hash);

      return {
        doc: {
          ...inserted.doc,
          nodes: {
            ...inserted.doc.nodes,
            [inserted.rootId]: { ...rootNode, iconAssetId: asset.id },
          },
          iconAssets: { ...(inserted.doc.iconAssets ?? {}), [asset.id]: asset },
        },
        rootId: inserted.rootId,
        asset,
      };
    },
    [stateRef, insertSubtree, viewportCenterWorld],
  );

  const insertIconAsset = useCallback(
    async (request: IconInsertRequest): Promise<NodeId | null> => {
      const sanitized = sanitizeIconSvg(request.svg);
      if (!sanitized) {
        announce(`Icon "${request.name}" failed security checks and was not inserted`);
        return null;
      }
      const sourceDoc = await svgToDocument(sanitized, request.name);
      if (!sourceDoc) {
        announce(`Icon "${request.name}" has no convertible content`);
        return null;
      }
      const computed = computeInsertion(request, sanitized, sourceDoc);
      if (!computed) return null;
      updateDoc(() => computed.doc);
      patch({ selection: [computed.rootId] });
      announce(`Inserted icon "${request.name}"`);
      return computed.rootId;
    },
    [announce, svgToDocument, computeInsertion, updateDoc, patch],
  );

  const replaceIconAsset = useCallback(
    async (nodeIds: NodeId[], request: IconInsertRequest): Promise<NodeId | null> => {
      const doc = stateRef.current.document;
      const targetNode = nodeIds
        .map((id) => doc.nodes[id])
        .find((node): node is SceneNode => Boolean(node));
      if (!targetNode) return null;
      const bounds = nodeBoundsOf(targetNode);

      const sanitized = sanitizeIconSvg(request.svg);
      if (!sanitized) {
        announce(`Icon "${request.name}" failed security checks and was not replaced`);
        return null;
      }
      const sourceDoc = await svgToDocument(sanitized, request.name);
      if (!sourceDoc) return null;

      const computed = computeInsertion(
        { ...request, position: bounds ?? undefined },
        sanitized,
        sourceDoc,
      );
      if (!computed) return null;

      // Scale the replacement to fit the previous bounds (preserving aspect,
      // anchored at the previous top-left) — pure, before the transaction.
      let rootNode = computed.doc.nodes[computed.rootId]!;
      let nextDoc = computed.doc;
      if (bounds) {
        const insertedBounds = nodeBoundsOf(rootNode);
        if (insertedBounds && insertedBounds.w > 0 && insertedBounds.h > 0) {
          const scale = Math.min(bounds.w / insertedBounds.w, bounds.h / insertedBounds.h);
          if (scale > 0 && scale < 1) {
            rootNode = applyDropPosition(scaleNodeAroundOrigin(rootNode, scale), {
              x: bounds.x,
              y: bounds.y,
            });
            nextDoc = { ...nextDoc, nodes: { ...nextDoc.nodes, [computed.rootId]: rootNode } };
          }
        }
      }

      const removed = removeNodesPure(nextDoc, new Set(nodeIds));
      updateDoc(() => removed.doc);
      patch({ selection: [computed.rootId] });
      announce(`Replaced icon with "${request.name}"`);
      return computed.rootId;
    },
    [stateRef, announce, svgToDocument, computeInsertion, updateDoc, patch],
  );

  const detachIconNodes = useCallback(
    (nodeIds: NodeId[]) => {
      const ids = new Set(nodeIds);
      updateDoc((d) => {
        const nodes: Record<string, SceneNode> = { ...d.nodes };
        for (const id of ids) {
          const node = nodes[id];
          if (node?.iconAssetId) {
            const { iconAssetId: _assetId, ...rest } = node;
            nodes[id] = rest as SceneNode;
          }
        }
        let iconAssets = d.iconAssets;
        if (iconAssets) {
          const remaining = Object.fromEntries(
            Object.entries(iconAssets).filter(([id]) => isIconAssetReferenced({ nodes }, id)),
          );
          iconAssets = Object.keys(remaining).length > 0 ? remaining : undefined;
        }
        return { ...d, nodes, iconAssets };
      });
      announce(`Detached ${ids.size} icon${ids.size > 1 ? 's' : ''} into editable nodes`);
    },
    [updateDoc, announce],
  );

  const getIconAsset = useCallback(
    (assetId: string): DocumentIconAsset | undefined => {
      return stateRef.current.document.iconAssets?.[assetId];
    },
    [stateRef],
  );

  const getIconAssetForNode = useCallback(
    (nodeId: string): DocumentIconAsset | undefined => {
      const node = stateRef.current.document.nodes[nodeId];
      return node?.iconAssetId
        ? stateRef.current.document.iconAssets?.[node.iconAssetId]
        : undefined;
    },
    [stateRef],
  );

  return {
    insertIconAsset,
    replaceIconAsset,
    detachIconNodes,
    getIconAsset,
    getIconAssetForNode,
  };
}
