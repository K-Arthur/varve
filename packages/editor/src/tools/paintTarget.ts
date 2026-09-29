/**
 * Where does paint go?
 *
 * One place answers that question for every paint tool. Scattering target
 * resolution through pointer handlers is how "am I painting the layer or its
 * mask?" ends up depending on which thumbnail was clicked most recently, with
 * no way for the UI to say what it will do.
 *
 * The resolver is deliberately explicit about failure: a locked or hidden layer
 * produces a described refusal rather than a silent no-op, so the tool can tell
 * the user why nothing happened instead of appearing broken.
 */
import type { Document, NodeId, SceneNode } from '@varve/scene';
import {
  activePageNodes,
  designCanvasContentRoot,
  getOwnRasterMaskAsset,
  nodeWorldTransform,
} from '@varve/scene';
import { tryInvertAffine } from '@varve/shared';

export type PaintTargetKind = 'rasterLayer' | 'rasterMask' | 'none';

export interface RasterLayerTarget {
  kind: 'rasterLayer';
  nodeId: NodeId;
  /** Human-readable target, for the canvas badge and screen readers. */
  label: string;
}

export interface RasterMaskTarget {
  kind: 'rasterMask';
  nodeId: NodeId;
  /** Which mask on the node is being edited. */
  maskId: string;
  label: string;
}

export interface NoPaintTarget {
  kind: 'none';
  /** Why painting is unavailable, phrased for the user. */
  reason: string;
  /** True when the editor could fix this by creating a raster layer. */
  canCreateLayer: boolean;
}

export type PaintTarget = RasterLayerTarget | RasterMaskTarget | NoPaintTarget;

export interface PaintTargetInput {
  document: Document;
  selection: readonly NodeId[];
  /** Set when the user has explicitly selected a mask to edit. */
  maskEditTarget?: { nodeId: NodeId; maskId: string } | null;
  /** Candidate layer found by the tool's own search, if any. */
  fallbackLayerId?: NodeId | null;
  /** Editor's page-placement-aware mapping, when available. */
  getWorldTransform?: (id: NodeId) => import('@varve/shared').Affine;
  /** Active Design Canvas when the editor is on a canvas surface. */
  designCanvasId?: NodeId | null;
}

function nodeName(node: SceneNode | undefined, fallback: string): string {
  const name = (node as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name ? name : fallback;
}

function isRaster(node: SceneNode | undefined): boolean {
  return (node as { kind?: unknown } | undefined)?.kind === 'rasterLayer';
}

function noTarget(reason: string, canCreateLayer = false): NoPaintTarget {
  return { kind: 'none', reason, canCreateLayer };
}

function safeParentIndexMap(doc: Document): Map<NodeId, NodeId> {
  const parents = new Map<NodeId, NodeId>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children)) continue;
    for (const childId of children) {
      if (typeof childId === 'string' && doc.nodes[childId]) parents.set(childId, id);
    }
  }
  return parents;
}

/** Validate page ownership, ancestor state and the exact transform used by a stroke. */
function validateNodeForPaint(input: PaintTargetInput, nodeId: NodeId): NoPaintTarget | null {
  const { document: doc, getWorldTransform } = input;
  const node = doc.nodes[nodeId];
  if (!node) return noTarget('That paint target no longer exists. Choose a layer again.');

  const parentIndex = safeParentIndexMap(doc);
  let currentId: NodeId | undefined = nodeId;
  let activeRootId: NodeId | null = null;
  const visited = new Set<NodeId>();
  while (currentId) {
    if (visited.has(currentId)) return noTarget('This layer has an invalid parent hierarchy.');
    visited.add(currentId);
    const current = doc.nodes[currentId];
    if (!current) return noTarget('This layer is no longer attached to the document.');
    if (current.visible === false) {
      return noTarget(`${nodeName(current, 'Layer')} is hidden. Show it to paint on it.`);
    }
    if (current.locked === true) {
      return noTarget(`${nodeName(current, 'Layer')} is locked. Unlock it to paint on it.`);
    }
    activeRootId = currentId;
    currentId = parentIndex.get(currentId);
  }

  if (
    !input.designCanvasId &&
    doc.activePageId &&
    !doc.pages?.some((page) => page.id === doc.activePageId)
  ) {
    return noTarget('The active page is no longer available. Choose a page before painting.');
  }

  const canvasRootId = input.designCanvasId
    ? designCanvasContentRoot(doc, input.designCanvasId)
    : null;
  const canvasRoot = canvasRootId ? doc.nodes[canvasRootId] : undefined;
  const activeRoots = new Set(
    input.designCanvasId
      ? canvasRoot && 'children' in canvasRoot && Array.isArray(canvasRoot.children)
        ? canvasRoot.children
        : []
      : activePageNodes(doc),
  );
  let currentScopeId: NodeId | undefined = nodeId;
  while (currentScopeId && !activeRoots.has(currentScopeId)) {
    currentScopeId = parentIndex.get(currentScopeId);
  }
  if (!activeRootId || !currentScopeId) {
    const surfaceReason = input.designCanvasId
      ? 'is not on the active canvas. Activate its canvas to paint on it.'
      : 'is not on the active page. Activate its page to paint on it.';
    return noTarget(`${nodeName(node, 'Layer')} ${surfaceReason}`);
  }

  let worldTransform: import('@varve/shared').Affine;
  try {
    worldTransform = getWorldTransform?.(nodeId) ?? nodeWorldTransform(doc, nodeId, parentIndex);
  } catch {
    return noTarget(`${nodeName(node, 'Layer')} has an invalid transform and cannot be painted.`);
  }
  if (!tryInvertAffine(worldTransform)) {
    return noTarget(`${nodeName(node, 'Layer')} has an invalid transform and cannot be painted.`);
  }
  return null;
}

function validateMask(
  input: PaintTargetInput,
  nodeId: NodeId,
  maskId: string,
): NoPaintTarget | null {
  const node = input.document.nodes[nodeId];
  const rasterMask = (
    node as { mask?: { rasterMask?: { assetId?: string; coordinateSpace?: string } } } | undefined
  )?.mask?.rasterMask;
  if (!rasterMask || rasterMask.assetId !== maskId) {
    return noTarget('That raster mask is no longer attached to this layer. Choose the mask again.');
  }
  if (rasterMask.coordinateSpace !== 'container-local-pixels') {
    return noTarget('This mask uses a pixel space the brush cannot safely edit yet.');
  }
  const asset = getOwnRasterMaskAsset(input.document, maskId);
  if (!asset?.dataUrl || asset.width <= 0 || asset.height <= 0) {
    return noTarget(
      'The selected mask asset is missing or invalid. Repair or replace the mask before painting.',
    );
  }
  return null;
}

/**
 * Resolve the paint target.
 *
 * Mask editing wins when it is explicitly active — that is the whole point of
 * having an explicit mode, and inferring it from selection instead is what
 * makes mask painting ambiguous.
 */
export function resolvePaintTarget(input: PaintTargetInput): PaintTarget {
  const { document: doc, selection, maskEditTarget, fallbackLayerId } = input;

  if (maskEditTarget) {
    const node = doc.nodes[maskEditTarget.nodeId];
    if (!node) {
      return noTarget('The masked layer no longer exists. Choose a layer again.');
    }
    const invalidNode = validateNodeForPaint(input, maskEditTarget.nodeId);
    if (invalidNode) return invalidNode;
    const invalidMask = validateMask(input, maskEditTarget.nodeId, maskEditTarget.maskId);
    if (invalidMask) return invalidMask;
    return {
      kind: 'rasterMask',
      nodeId: maskEditTarget.nodeId,
      maskId: maskEditTarget.maskId,
      label: `Layer Mask — ${nodeName(node, 'Layer')}`,
    };
  }

  const selectedRaster = selection.find((id) => isRaster(doc.nodes[id]));
  if (selection.length > 0 && !selectedRaster) {
    const selectedNodeId = selection[0]!;
    const selectedNode = doc.nodes[selectedNodeId];
    if (!selectedNode)
      return noTarget('The selected layer no longer exists. Choose a layer again.');
    if (selectedNode.kind !== 'rasterLayer') {
      return noTarget(
        `${nodeName(selectedNode, 'This layer')} is not a pixel layer. Create a paint layer, then select it to paint.`,
        true,
      );
    }
  }

  const candidateId = selectedRaster ?? (selection.length === 0 ? fallbackLayerId : null) ?? null;
  if (!candidateId) {
    return noTarget('No pixel layer to paint on. A paint layer will be created.', true);
  }

  const node = doc.nodes[candidateId];
  if (!node || !isRaster(node) || node.id !== candidateId) {
    return noTarget(
      'The paint layer no longer exists. Choose a layer again.',
      selection.length === 0,
    );
  }
  const invalidNode = validateNodeForPaint(input, candidateId);
  if (invalidNode) return invalidNode;

  return {
    kind: 'rasterLayer',
    nodeId: candidateId,
    label: nodeName(node, 'Layer'),
  };
}

/** Short status text for the canvas badge, e.g. "Painting: Layer Mask". */
export function paintTargetStatus(target: PaintTarget): string {
  switch (target.kind) {
    case 'rasterMask':
      return `Painting: ${target.label}`;
    case 'rasterLayer':
      return `Painting: ${target.label}`;
    default:
      return target.reason;
  }
}

/**
 * Whether the colour controls apply.
 *
 * A grayscale mask stores coverage, not colour, so offering a colour picker
 * while painting one promises something the format cannot keep.
 */
export function targetUsesColor(target: PaintTarget): boolean {
  return target.kind === 'rasterLayer';
}

/** Tools that make no sense against a grayscale mask. */
export function targetSupportsTool(target: PaintTarget, tool: string): boolean {
  if (target.kind !== 'rasterMask') return target.kind === 'rasterLayer';
  // Clone and heal move colour between regions of an image; against a
  // one-channel mask they have nothing meaningful to do, so they are disabled
  // rather than quietly editing the content layer instead.
  return tool !== 'cloneStamp' && tool !== 'healBrush';
}
