/**
 * Image-mask coordinate adapter for editor pointer tools.
 *
 * Research basis: inverse scene-graph affine composition followed by the
 * renderer's canonical source-image placement inverse. Keeping this adapter
 * independent of tool state lets refine, trimap, mouse, pen, and touch paths
 * share identical pixel targeting.
 */
import { computeImagePlacement, type ImagePlacement, localToSourcePixel } from '@strata/engine';
import type { Document, SceneNode } from '@strata/scene';
import { getImageFill } from '@strata/scene';
import { applyAffine, tryInvertAffine } from '@strata/shared';
import { nodeLocalBounds, nodeWorldTransform } from '../scene/world';

export interface WorldPointToImageMaskPixelOptions {
  document: Document;
  node: SceneNode;
  sourceWidth: number;
  sourceHeight: number;
  worldPoint: { x: number; y: number };
  /** Reuse placement computed by a hot pointer path when available. */
  placement?: ImagePlacement;
}

/** Convert a world pointer to a source-image mask pixel, or null when unpainted. */
export function worldPointToImageMaskPixel(
  options: WorldPointToImageMaskPixelOptions,
): { x: number; y: number } | null {
  const { document, node, sourceWidth, sourceHeight, worldPoint } = options;
  if (node.kind !== 'shape') return null;
  const image = getImageFill(node)?.image;
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

  const inverseWorld = tryInvertAffine(nodeWorldTransform(document, node.id));
  if (!inverseWorld) return null;
  const [x, y] = applyAffine(inverseWorld, [worldPoint.x, worldPoint.y]);
  return localToSourcePixel(placement, { x, y });
}
