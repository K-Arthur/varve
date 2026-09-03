/**
 * Scene-level flatten operations — pure document mutations for the
 * unified flatten system.
 */

export {
  computeFlattenBounds,
  effectPadding,
  findCommonAncestor,
  insertFlattenedCopy,
  mergeNodes,
  nodeEffectPadding,
  replaceNodesWithFlattened,
} from './bounds';
export type { FlattenReplacement } from './flattenOps';
export type { BoundsRect } from './types';
