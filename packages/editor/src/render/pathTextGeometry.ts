/**
 * Resolve referenced path geometry into the text node's local space.
 *
 * The replay transform belongs to the text node. The path shape, however, is
 * authored in the referenced shape node's local space. Keeping this conversion
 * at the scene→engine boundary makes text-on-path work when the two nodes were
 * drawn in different places and keeps later path edits live.
 */

import { type Shape, transformPathShape } from '@varve/engine';
import { type Affine, multiplyAffine, tryInvertAffine } from '@varve/shared';

export function pathShapeInTextSpace(
  pathShape: Shape,
  pathWorld: Affine,
  textWorld: Affine,
): Shape {
  const textInverse = tryInvertAffine(textWorld);
  if (!textInverse) return pathShape;
  return transformPathShape(pathShape, multiplyAffine(textInverse, pathWorld));
}
