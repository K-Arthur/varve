/**
 * Detect scenes that require structural compositing (masks, isolated groups).
 * Flat worker replay cannot handle these — main-thread replaySubtree is required.
 */
import type { Document } from '@strata/scene';

export function sceneNeedsStructuralCompositing(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (!node) continue;
    if ('mask' in node && node.mask?.visible) return true;
    if (node.kind === 'frame' && node.children.length > 0 && node.clipContent !== false) {
      return true;
    }
    if (node.kind === 'group') {
      const needsFlatten =
        node.isolated === true ||
        (node.blendMode && node.blendMode !== 'normal' && node.blendMode !== 'passThrough') ||
        (node.opacity !== undefined && node.opacity < 1);
      if (needsFlatten && node.children.length > 0) return true;
    }
  }
  return false;
}
