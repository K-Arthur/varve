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
import type { Affine } from '@varve/engine';
import { type Document, getById, nextNodeId, removeNode } from './document';
import type { LiveTraceParams, LiveTraceState, NodeId } from './types';
import { defaultLiveTraceParams, migrateLiveTraceParams } from './types';

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
    params: migrateLiveTraceParams({
      ...defaultLiveTraceParams(),
      ...(existing?.params ?? {}),
      ...params,
    }) as LiveTraceParams,
    resolvedAt: null,
    lastError: null,
    traceGroupId: undefined,
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
export function setLiveTraceResolved(
  doc: Document,
  nodeId: NodeId,
  resolvedAt: number,
  traceGroupId?: NodeId,
): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape?.liveTrace) return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...shape,
        liveTrace: { ...shape.liveTrace, resolvedAt, lastError: null, traceGroupId },
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
  if (!shape?.liveTrace) return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...shape,
        liveTrace: {
          ...shape.liveTrace,
          resolvedAt: null,
          lastError: error,
          traceGroupId: undefined,
        },
      },
    },
  };
}

/**
 * Flatten a live-traced node: commit the generated trace group and remove the
 * source image node. The trace group becomes a normal editable group.
 */
export function flattenLiveTrace(doc: Document, nodeId: NodeId): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape?.liveTrace) return doc;

  const traceGroupId = shape.liveTrace.traceGroupId;
  if (traceGroupId && doc.nodes[traceGroupId]) {
    let next = removeNode(doc, nodeId);
    const traceGroup = next.nodes[traceGroupId];
    if (traceGroup && 'locked' in traceGroup) {
      next = {
        ...next,
        nodes: { ...next.nodes, [traceGroupId]: { ...traceGroup, locked: false } },
      };
    }
    return next;
  }

  const { liveTrace: _removed, ...rest } = shape;
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: rest as import('./types').ShapeNode } };
}

/**
 * Cancel a live trace: restore the source image node and remove the generated
 * trace group. No-op when the node has no liveTrace state.
 */
export function clearLiveTrace(doc: Document, nodeId: NodeId): Document {
  const shape = isShapeNode(doc, nodeId);
  if (!shape?.liveTrace) return doc;

  const traceGroupId = shape.liveTrace.traceGroupId;
  let next: Document = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: { ...shape, liveTrace: undefined, visible: true },
    },
  };
  if (traceGroupId && next.nodes[traceGroupId]) {
    next = removeNode(next, traceGroupId);
  }
  return next;
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
  if (!shape?.liveTrace) return doc;

  // Generate a unique id for the derived node
  const allocation = nextNodeId(doc);
  const derivedId = allocation.id;

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
    ...allocation.doc,
    nodes: { ...allocation.doc.nodes, [derivedId]: derivedNode },
  };
}
