/**
 * Liquify scene operations — document- and node-level mutation of a persisted
 * deformation field and freeze mask.
 *
 * The source tiles are never touched by these operations: a stroke only
 * changes the deformation, which the IR builder resamples. Undo therefore
 * stores a small field diff (ordinary structural sharing of arrays), not a
 * second copy of the layer pixels.
 *
 * Targets: raster layers (including an explicitly selected frequency band) and
 * frequency-separation groups (a shared deformation on the recombined
 * composite). A group without a valid separation marker is not a target.
 */

import {
  applyLiquifyDab,
  clampLiquifyField,
  createFreezeSampler,
  createLiquifyField,
  decodeFreezeMask,
  encodeFreezeMask,
  type FreezeSampler,
  LIQUIFY_FREEZE_MAX_DIMENSION,
  type LiquifyDab,
  type LiquifyField,
  type LiquifyFreezeMask,
  type LiquifyMode,
  liquifyFieldRevision,
  stampFreezeMask,
  validateLiquifyField,
} from '@varve/engine';
import type { Document } from './document';
import { getFrequencySeparationState } from './frequencySeparation';
import type { RasterLayerNode, SceneNode } from './types';

export interface FreezeMaskData {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Resolution of the freeze mask for a layer, capped for bounded persistence. */
export function freezeMaskDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const safeW = safeLayerDimension(width);
  const safeH = safeLayerDimension(height);
  const scale = Math.min(1, LIQUIFY_FREEZE_MAX_DIMENSION / Math.max(safeW, safeH));
  return {
    width: Math.max(8, Math.round(safeW * scale)),
    height: Math.max(8, Math.round(safeH * scale)),
  };
}

/** Decode a node's persisted freeze mask, if any. */
export function decodeNodeFreezeMask(node: {
  liquifyFreeze?: LiquifyFreezeMask;
}): FreezeMaskData | null {
  const stored = node.liquifyFreeze;
  if (!stored) return null;
  if (
    !Number.isSafeInteger(stored.width) ||
    !Number.isSafeInteger(stored.height) ||
    stored.width <= 0 ||
    stored.height <= 0 ||
    stored.width > LIQUIFY_FREEZE_MAX_DIMENSION ||
    stored.height > LIQUIFY_FREEZE_MAX_DIMENSION
  ) {
    return null;
  }
  const expected = stored.width * stored.height;
  const data = decodeFreezeMask(stored.rle, expected);
  if (!data) return null;
  return { width: stored.width, height: stored.height, data };
}

export function encodeNodeFreezeMask(mask: FreezeMaskData): LiquifyFreezeMask {
  return { width: mask.width, height: mask.height, rle: encodeFreezeMask(mask.data) };
}

export function freezeSamplerForNode(node: {
  liquifyFreeze?: LiquifyFreezeMask;
}): FreezeSampler | null {
  const mask = decodeNodeFreezeMask(node);
  if (!mask) return null;
  return createFreezeSampler(mask.width, mask.height, mask.data);
}

export function getLiquifyField(
  node: { liquify?: LiquifyField } | null | undefined,
): LiquifyField | null {
  if (!node) return null;
  return validateLiquifyField(node.liquify);
}

/** True when the node can carry a liquify deformation. */
export function canLiquifyNode(
  node: SceneNode | undefined | null,
): node is RasterLayerNode | (SceneNode & { kind: 'group' }) {
  if (!node) return false;
  if (node.kind === 'rasterLayer') return true;
  if (node.kind === 'group') return getFrequencySeparationState(node) !== null;
  return false;
}

/**
 * The field a stroke should begin from. An absent or malformed field starts
 * at identity rather than aborting the stroke; the next commit replaces the
 * malformed data with a valid field.
 */
export function ensureLiquifyField(node: {
  width: number;
  height: number;
  liquify?: LiquifyField;
}): LiquifyField {
  return validateLiquifyField(node.liquify) ?? createLiquifyField(node.width, node.height);
}

/** Node-level dab application, for `updateNode`-style transactions. */
export function applyLiquifyDabToSceneNode(
  node: SceneNode,
  mode: LiquifyMode,
  dab: LiquifyDab,
  freeze?: FreezeSampler | null,
  doc?: { nodes: Record<string, SceneNode> },
): SceneNode | null {
  if (!canLiquifyNode(node)) return null;
  const field =
    node.kind === 'rasterLayer' ? ensureLiquifyField(node) : ensureGroupLiquifyField(node, doc);
  const next = clampLiquifyField(applyLiquifyDab(field, mode, dab, freeze ?? null));
  return { ...node, liquify: next } as SceneNode;
}

/**
 * Group fields are authored in the tone band's pixel space, which is exactly
 * the decoded composite's space. Falling back to a nominal extent keeps a
 * malformed marker from aborting the stroke (validation repairs the field on
 * the next commit).
 */
function ensureGroupLiquifyField(
  node: SceneNode,
  doc?: { nodes: Record<string, SceneNode> },
): LiquifyField {
  const existing = validateLiquifyField((node as { liquify?: LiquifyField }).liquify);
  if (existing) return existing;
  const state = getFrequencySeparationState(node);
  const low = state && doc ? doc.nodes[state.lowNodeId] : undefined;
  if (low && low.kind === 'rasterLayer') {
    return createLiquifyField(low.width, low.height);
  }
  return createLiquifyField(1024, 1024);
}

/** Apply one dab to a document node. Returns the updated document. */
export function applyLiquifyDabToNode(
  doc: Document,
  nodeId: string,
  mode: LiquifyMode,
  dab: LiquifyDab,
  freeze?: FreezeSampler | null,
): Document | null {
  const node = doc.nodes[nodeId];
  if (!node || !canLiquifyNode(node)) return null;
  const updated = applyLiquifyDabToSceneNode(node, mode, dab, freeze, doc);
  if (!updated) return null;
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}

/** Reset a region of the deformation (local restore / eraser). */
export function resetLiquifyRegionOnNode(
  doc: Document,
  nodeId: string,
  x: number,
  y: number,
  radius: number,
  amount = 1,
): Document | null {
  const node = doc.nodes[nodeId];
  if (!node || !canLiquifyNode(node)) return null;
  const field = getLiquifyField(node as { liquify?: LiquifyField });
  if (!field) return null;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: { ...node, liquify: resetRegion(field, x, y, radius, amount) } as SceneNode,
    },
  };
}

function resetRegion(
  field: LiquifyField,
  x: number,
  y: number,
  radius: number,
  amount: number,
): LiquifyField {
  return clampLiquifyField(
    applyLiquifyDab(
      field,
      'restore',
      {
        x,
        y,
        radius,
        strength: Math.max(0, Math.min(1, amount)),
        pressure: 1,
        deltaX: 0,
        deltaY: 0,
        dtMs: 1000 / 60,
      },
      null,
    ),
  );
}

/** Remove all deformation from a node (Reset All). */
export function clearLiquifyOnNode(doc: Document, nodeId: string): Document | null {
  const node = doc.nodes[nodeId];
  if (!node || !canLiquifyNode(node)) return null;
  const { liquify: _dropped, ...rest } = node as SceneNode & { liquify?: LiquifyField };
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: rest as SceneNode } };
}

/** Replace the persisted freeze mask wholesale (stroke commit). */
export function setLiquifyFreezeMask(
  doc: Document,
  nodeId: string,
  mask: FreezeMaskData | null,
): Document | null {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'rasterLayer') return null;
  if (!mask) {
    const { liquifyFreeze: _dropped, ...rest } = node;
    return { ...doc, nodes: { ...doc.nodes, [nodeId]: rest as SceneNode } };
  }
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: { ...node, liquifyFreeze: encodeNodeFreezeMask(mask) },
    },
  };
}

/** Node-level freeze commit, for `updateNode`-style transactions. */
export function setLiquifyFreezeMaskOnNode(
  node: RasterLayerNode,
  mask: FreezeMaskData | null,
): RasterLayerNode {
  if (!mask) {
    const { liquifyFreeze: _dropped, ...rest } = node;
    return rest as RasterLayerNode;
  }
  return { ...node, liquifyFreeze: encodeNodeFreezeMask(mask) };
}

/** Paint a freeze/thaw dab into a session mask (caller commits on stroke end). */
export function stampFreezeMaskData(
  mask: FreezeMaskData,
  layerWidth: number,
  layerHeight: number,
  layerX: number,
  layerY: number,
  layerRadius: number,
  freeze: boolean,
  hardness = 0.6,
): void {
  if (
    !Number.isFinite(layerWidth) ||
    !Number.isFinite(layerHeight) ||
    !Number.isFinite(layerX) ||
    !Number.isFinite(layerY) ||
    !Number.isFinite(layerRadius) ||
    layerWidth <= 0 ||
    layerHeight <= 0
  ) {
    return;
  }
  const sx = mask.width / Math.max(1, layerWidth);
  const sy = mask.height / Math.max(1, layerHeight);
  stampFreezeMask(
    mask.data,
    mask.width,
    mask.height,
    layerX * sx,
    layerY * sy,
    layerRadius * ((sx + sy) / 2),
    freeze,
    hardness,
  );
}

function safeLayerDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.round(value));
}

/** Stable revision for render caches: field only (freeze never affects output). */
export function rasterLiquifyRevision(node: { liquify?: LiquifyField }): string {
  return liquifyFieldRevision(validateLiquifyField(node.liquify));
}

export function hasLiquify(node: { liquify?: LiquifyField } | undefined | null): boolean {
  const field = getLiquifyField(node);
  if (!field) return false;
  return field.displacement.some((value) => Math.abs(value) > 1e-4);
}
