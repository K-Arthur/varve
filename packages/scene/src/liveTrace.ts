/**
 * Live trace data model and operations for nondestructive raster-to-vector.
 *
 * A ShapeNode with an image fill can carry a `liveTrace` state that links it
 * to a live trace pipeline: the user adjusts trace parameters and the result
 * updates in place (vs the old one-shot GroupNode beside the source).
 *
 * Research basis: nondestructive image → vector workflows (Illustrator Live
 * Trace, Affinity Designer, potrace-on-file-watch). The live trace state is
 * stored on the source image node so it survives save/load and undo.
 */
import type { Affine } from '@strata/engine';
import type { Document } from './document';
import { getById } from './document';
import type { LiveTraceParams, LiveTraceState, NodeId } from './types';
import { defaultLiveTraceParams } from './types';

function isShapeNode(doc: Document, nodeId: NodeId): import('./types').ShapeNode | undefined {
  const node = getById(doc, nodeId);
  if (node?.kind === 'shape') return node as import('./types').ShapeNode;
  return undefined;
}

/**
 * Set or update live trace parameters on a node.
 * Resets `resolvedAt` to null (pending re-trace) if the node already has live
 * trace state, or creates new live trace state if none existed.
 */
export function setLiveTraceParams(
  doc: Document,
  nodeId: NodeId,
  params: Partial<LiveTraceParams>,
): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape) return doc;

  const existing: LiveTraceState | undefined = shape.liveTrace;
  const merged: LiveTraceState = {
    sourceNodeId: existing?.sourceNodeId ?? nodeId,
    params: { ...defaultLiveTraceParams(), ...(existing?.params ?? {}), ...params },
    resolvedAt: null,
    lastError: existing?.lastError ?? null,
  };

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: { ...shape, liveTrace: merged },
    },
  };
}

/**
 * Mark a live trace as successfully resolved.
 * Sets `resolvedAt` to the given timestamp and clears any error.
 */
export function setLiveTraceResolved(doc: Document, nodeId: NodeId, resolvedAt: number): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape || !shape.liveTrace) return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...shape,
        liveTrace: { ...shape.liveTrace, resolvedAt, lastError: null },
      },
    },
  };
}

/**
 * Record a live trace error.
 * Sets `lastError` and clears `resolvedAt`.
 */
export function setLiveTraceError(doc: Document, nodeId: NodeId, error: string): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape || !shape.liveTrace) return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...shape,
        liveTrace: { ...shape.liveTrace, resolvedAt: null, lastError: error },
      },
    },
  };
}

/**
 * Flatten a live-traced node: remove `liveTrace` state.
 * The node's current shape is preserved (if traced geometry was resolved, it
 * stays as the explicit shape; otherwise the fallback shape is kept).
 * The result is an ordinary ShapeNode with no liveTrace field.
 */
export function flattenLiveTrace(doc: Document, nodeId: NodeId): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape || !shape.liveTrace) return doc;

  const { liveTrace: _removed, ...rest } = shape;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: rest as import('./types').ShapeNode,
    },
  };
}

/**
 * Remove live trace state from a node without flattening.
 * Equivalent to discarding the live trace link; the node remains as-is.
 * No-op when the node has no liveTrace state.
 */
export function clearLiveTrace(doc: Document, nodeId: NodeId): Document {
  return flattenLiveTrace(doc, nodeId);
}

/**
 * "Bake to raster": create a new derived image node from a live-traced node's
 * current state, rendered to pixels.
 *
 * This is the backward direction of the raster-vector link: instead of vector
 * following raster (the forward direction, item 2), this action creates a NEW
 * raster node from the current traced vector state. The original source and
 * live-traced nodes are preserved unchanged.
 *
 * Semantics (resolved per Item 4 methodology):
 * - NOT destructive bidirectional sync (no competitor has shipped this)
 * - NOT overwrite-in-place of the source raster
 * - Explicit, undoable "bake forward" action: renders current traced geometry
 *   to pixels → creates a new derived image node beside the source
 * - The user can choose to replace the original or keep both
 *
 * The `pixelData` and `dimensions` are provided by the caller (editor context
 * with canvas access renders the traced paths to a data URL).
 */
export function bakeLiveTraceToRaster(
  doc: Document,
  nodeId: NodeId,
  pixelData: string,
  dimensions: { w: number; h: number },
): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape || !shape.liveTrace) return doc;

  // Generate a unique id for the derived node
  const derivedId = `derived_${nodeId}_${Date.now()}`;

  const derivedNode: import('./types').ShapeNode = {
    id: derivedId,
    kind: 'shape',
    name: `${shape.name ?? 'Image'} (rasterized)`,
    shape: { kind: 'rect', x: 0, y: 0, w: dimensions.w, h: dimensions.h },
    transform: (shape.transform ?? [1, 0, 0, 1, 0, 0]) as Affine,
    order: shape.order ?? '',
    visible: shape.visible ?? true,
    locked: shape.locked ?? false,
    rotation: shape.rotation ?? 0,
    opacity: shape.opacity ?? 1,
    blendMode: shape.blendMode ?? 'normal',
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [
      {
        type: 'image',
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        image: {
          src: pixelData,
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: dimensions.w,
          imageHeight: dimensions.h,
        },
      },
    ],
    strokes: [],
    effects: [],
  };

  return {
    ...doc,
    nodes: { ...doc.nodes, [derivedId]: derivedNode },
  };
}
