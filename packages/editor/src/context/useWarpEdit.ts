/**
 * Warp tool editing state — which node's modifier the Warp overlay and
 * Inspector are currently manipulating.
 *
 * Transient editor state only (like brushSettings/quickMask): the persistent
 * modifier stack lives on the Document nodes.
 */

import type { NodeId } from '@varve/scene';
import { useCallback } from 'react';

export interface WarpEditTarget {
  nodeId: NodeId;
  modifierId: string;
}

export type WarpEditState = WarpEditTarget | null;

export interface UseWarpEditResult {
  warpEdit: WarpEditState;
  setWarpEdit: (target: WarpEditTarget | null) => void;
}

export function useWarpEdit(
  state: { warpEdit?: WarpEditState },
  setState: (updater: (s: Record<string, unknown>) => Record<string, unknown>) => void,
): UseWarpEditResult {
  const setWarpEdit = useCallback(
    (target: WarpEditTarget | null) => {
      setState((s) => {
        const current = s.warpEdit as WarpEditState | undefined;
        const next = target ? { nodeId: target.nodeId, modifierId: target.modifierId } : null;
        if (
          current === next ||
          (current &&
            next &&
            current.nodeId === next.nodeId &&
            current.modifierId === next.modifierId)
        ) {
          return s;
        }
        return { ...s, warpEdit: next };
      });
    },
    [setState],
  );
  return { warpEdit: state.warpEdit ?? null, setWarpEdit };
}
