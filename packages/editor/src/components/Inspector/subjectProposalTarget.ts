/**
 * Canonical placement identity for automatic foreground proposals.
 *
 * A proposal is only useful when its source pixels still map to the same
 * document location that the user reviewed. Keep this calculation beside the
 * prompted Object Selection path so crop, image offsets, content rotation,
 * flips, and ancestor transforms cannot drift between selection tools.
 */
import type { Document, SceneNode } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { prepareImageMaskMapper } from '../../tools/imageMaskCoordinates';

export function subjectProposalMappingFingerprint(
  document: Document,
  node: SceneNode | undefined,
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
): string | null {
  if (
    !node ||
    !isImageShape(node) ||
    typeof sourceWidth !== 'number' ||
    typeof sourceHeight !== 'number' ||
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }
  return (
    prepareImageMaskMapper({
      document,
      node,
      sourceWidth,
      sourceHeight,
    })?.fingerprint ?? null
  );
}
