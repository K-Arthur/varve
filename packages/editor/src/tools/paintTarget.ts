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
  document: Pick<Document, 'nodes'> & { nodes: Record<string, SceneNode> };
  selection: readonly NodeId[];
  /** Set when the user has explicitly selected a mask to edit. */
  maskEditTarget?: { nodeId: NodeId; maskId: string } | null;
  /** Candidate layer found by the tool's own search, if any. */
  fallbackLayerId?: NodeId | null;
}

function nodeName(node: SceneNode | undefined, fallback: string): string {
  const name = (node as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name ? name : fallback;
}

function isRaster(node: SceneNode | undefined): boolean {
  return (node as { kind?: unknown } | undefined)?.kind === 'rasterLayer';
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
      return { kind: 'none', reason: 'The masked layer no longer exists.', canCreateLayer: false };
    }
    const locked = (node as { locked?: unknown }).locked === true;
    if (locked) {
      return {
        kind: 'none',
        reason: `${nodeName(node, 'Layer')} is locked. Unlock it to paint its mask.`,
        canCreateLayer: false,
      };
    }
    return {
      kind: 'rasterMask',
      nodeId: maskEditTarget.nodeId,
      maskId: maskEditTarget.maskId,
      label: `Layer Mask — ${nodeName(node, 'Layer')}`,
    };
  }

  const candidateId = selection.find((id) => isRaster(doc.nodes[id])) ?? fallbackLayerId ?? null;
  if (!candidateId) {
    const selectedNonRaster = selection.find((id) => doc.nodes[id]);
    if (selectedNonRaster) {
      return {
        kind: 'none',
        reason: `${nodeName(doc.nodes[selectedNonRaster], 'This layer')} is not a pixel layer.`,
        canCreateLayer: true,
      };
    }
    return { kind: 'none', reason: 'No pixel layer to paint on.', canCreateLayer: true };
  }

  const node = doc.nodes[candidateId];
  if ((node as { locked?: unknown }).locked === true) {
    // Never auto-unlock: a lock is a decision the user made, and silently
    // overriding it is worse than refusing to paint.
    return {
      kind: 'none',
      reason: `${nodeName(node, 'Layer')} is locked.`,
      canCreateLayer: false,
    };
  }
  if ((node as { visible?: unknown }).visible === false) {
    return {
      kind: 'none',
      reason: `${nodeName(node, 'Layer')} is hidden. Show it to paint on it.`,
      canCreateLayer: false,
    };
  }

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
