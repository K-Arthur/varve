/**
 * World-space transform and bounds helpers for the editor.
 *
 * These are the single source of truth for converting between a node's local
 * coordinate space and the world coordinate space used by the renderer,
 * hit-tester, selection overlay, and reveal logic.
 *
 * Canonical implementations now live in @strata/scene's coordinateService.
 * This file re-exports for backward compatibility.
 *
 * Research basis: scene-graph transform composition (standard affine chain).
 * Each node's `transform` is a local→parent affine; the world matrix is the
 * product of all ancestor transforms left-multiplied by the node's own.
 */

import type { Document, NodeId } from '@strata/scene';
import {
  groupWorldBounds as sceneGroupWorldBounds,
  nodeWorldBounds as sceneNodeWorldBounds,
  nodeWorldTransform as sceneNodeWorldTransform,
} from '@strata/scene';
import type { Affine, Rect } from '@strata/shared';

export { nodeLocalBounds } from './nodeBounds';

/**
 * @deprecated Import from @strata/scene instead. This re-export is for
 * backward compatibility during the phased migration.
 */
export function nodeWorldTransform(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Affine {
  return sceneNodeWorldTransform(doc, id, parentIndex);
}

/**
 * @deprecated Import from @strata/scene instead. This re-export is for
 * backward compatibility during the phased migration.
 */
export function groupWorldBounds(
  doc: Document,
  groupId: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  return sceneGroupWorldBounds(doc, groupId, parentIndex);
}

/**
 * @deprecated Import from @strata/scene instead. This re-export is for
 * backward compatibility during the phased migration.
 */
export function nodeWorldBounds(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  return sceneNodeWorldBounds(doc, id, parentIndex);
}
