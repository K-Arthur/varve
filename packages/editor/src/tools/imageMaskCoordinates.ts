/**
 * Image-mask coordinate adapter for editor pointer tools.
 *
 * Research basis: inverse scene-graph affine composition followed by the
 * renderer's canonical source-image placement inverse. Keeping this adapter
 * independent of tool state lets refine, trimap, mouse, pen, and touch paths
 * share identical pixel targeting.
 */
import {
  computeImagePlacement,
  type ImagePlacement,
  localToSourcePixel,
  sourcePixelToLocal,
} from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { buildParentIndexMap, resolveNodePaints } from '@varve/scene';
import { applyAffine, tryInvertAffine } from '@varve/shared';
import { nodeLocalBounds, nodeWorldTransform } from '../scene/world';

export interface PrepareImageMaskMapperOptions {
  document: Document;
  node: SceneNode;
  sourceWidth: number;
  sourceHeight: number;
  /** Reuse placement computed by a hot pointer path when available. */
  placement?: ImagePlacement;
  /** Reuse a document-level parent index when preparing multiple nodes. */
  parentIndex?: Map<NodeId, NodeId>;
}

export interface PreparedImageMaskMapper {
  readonly placement: ImagePlacement;
  mapWorldPoint(worldPoint: { x: number; y: number }): { x: number; y: number } | null;
  /** Map a source-image pixel back into document space for selection clipping. */
  mapSourcePixelToWorld(sourcePoint: { x: number; y: number }): { x: number; y: number } | null;
}

export interface WorldPointToImageMaskPixelOptions extends PrepareImageMaskMapperOptions {
  worldPoint: { x: number; y: number };
}

/**
 * Prepare a reusable world-to-source mapper for a pointer stroke.
 *
 * Paint resolution, parent indexing, world-transform composition, and matrix
 * inversion happen once here. Per-sample mapping performs only affine and
 * placement arithmetic.
 */
export function prepareImageMaskMapper(
  options: PrepareImageMaskMapperOptions,
): PreparedImageMaskMapper | null {
  const { document, node, sourceWidth, sourceHeight } = options;
  // Identity matters: an immutable document may replace a node while a
  // pointer stroke is active. Never edit a detached stale object with the
  // same id as the current node.
  if (document.nodes[node.id] !== node || node.kind !== 'shape') return null;
  const image = resolveNodePaints(
    node as unknown as Parameters<typeof resolveNodePaints>[0],
    document,
  ).find((fill) => fill.type === 'image')?.image;
  const bounds = nodeLocalBounds(node, document);
  if (!image || !bounds) return null;

  const placement =
    options.placement ??
    computeImagePlacement({
      fit: image.fit,
      sourceWidth,
      sourceHeight,
      bounds,
      x: image.x,
      y: image.y,
      scale: image.scale,
    });
  if (!placement) return null;

  const parentIndex = options.parentIndex ?? buildParentIndexMap(document);
  const worldTransform = nodeWorldTransform(document, node.id, parentIndex);
  const inverseWorld = tryInvertAffine(worldTransform);
  if (!inverseWorld) return null;
  return {
    placement,
    mapWorldPoint(worldPoint) {
      const [x, y] = applyAffine(inverseWorld, [worldPoint.x, worldPoint.y]);
      return localToSourcePixel(placement, { x, y });
    },
    mapSourcePixelToWorld(sourcePoint) {
      const local = sourcePixelToLocal(placement, sourcePoint);
      if (!local) return null;
      const [x, y] = applyAffine(worldTransform, [local.x, local.y]);
      return { x, y };
    },
  };
}

/** Convert one world pointer to a source-image mask pixel, or null when unpainted. */
export function worldPointToImageMaskPixel(
  options: WorldPointToImageMaskPixelOptions,
): { x: number; y: number } | null {
  const mapper = prepareImageMaskMapper(options);
  return mapper?.mapWorldPoint(options.worldPoint) ?? null;
}
