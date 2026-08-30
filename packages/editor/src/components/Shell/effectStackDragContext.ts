import type { EffectStackKind, EffectStackTransferMode, NodeId } from '@varve/scene';
import { createContext, useContext } from 'react';

/** The appearance stack currently being dragged over a Layers tree row. */
export interface EffectStackDragState {
  sourceId: NodeId;
  targetId: NodeId | null;
  stackKind: EffectStackKind;
  transferMode: EffectStackTransferMode;
}

export const EffectStackDragContext = createContext<EffectStackDragState | null>(null);

/**
 * The Layers tree consumes this instead of dnd-kit's collision result.
 * Its rows are virtualized, so resolving the actual element under the live
 * pointer is more reliable than a stale measured rectangle.
 */
export function useEffectStackDrag(): EffectStackDragState | null {
  return useContext(EffectStackDragContext);
}
