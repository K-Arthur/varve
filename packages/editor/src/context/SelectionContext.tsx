import type { NodeId, SceneNode } from '@strata/scene';
import { resolveNodeFills } from '@strata/scene';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { EditorState } from './types';

export interface SelectionContextValue {
  selection: NodeId[];
  setSelection: (id: NodeId | null) => void;
  toggleSelection: (id: NodeId, additive?: boolean) => void;
  isSelected: (id: NodeId) => boolean;
  selectedNodes: () => SceneNode[];
  selectAllWithSameType: () => void;
  selectAllWithSameFill: () => void;
  selectAllWithSameLayerColor: () => void;
  selectAllOfType: () => void;
}

const SelectionCtx = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionCtx);
  if (!ctx) throw new Error('useSelection must be used within EditorProvider');
  return ctx;
}

interface SelectionProviderProps {
  children: ReactNode;
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
}

export function SelectionProvider({ children, state, setState }: SelectionProviderProps) {
  const setSelection = useCallback(
    (id: NodeId | null) => setState((s) => ({ ...s, selection: id ? [id] : [] })),
    [setState],
  );

  const toggleSelection = useCallback(
    (id: NodeId, additive?: boolean) => {
      setState((s) => {
        if (additive) {
          const exists = s.selection.includes(id);
          return {
            ...s,
            selection: exists ? s.selection.filter((nid) => nid !== id) : [...s.selection, id],
          };
        }
        return { ...s, selection: [id] };
      });
    },
    [setState],
  );

  const isSelected = useCallback((id: NodeId) => state.selection.includes(id), [state.selection]);

  const selectedNodes = useCallback(
    () =>
      state.selection
        .map((id) => state.document.nodes[id])
        .filter((n): n is SceneNode => Boolean(n)),
    [state.selection, state.document.nodes],
  );

  const selectAllWithSameType = useCallback(() => {
    setState((s) => {
      const firstId = s.selection[0];
      if (!firstId) return s;
      const first = s.document.nodes[firstId];
      if (!first) return s;
      const kind = first.kind;
      const candidates: NodeId[] = [];
      for (const [id, node] of Object.entries(s.document.nodes)) {
        if (
          node &&
          node.kind === kind &&
          !(node as SceneNode).locked &&
          (node as SceneNode).visible !== false
        ) {
          candidates.push(id);
        }
      }
      return { ...s, selection: candidates };
    });
  }, [setState]);

  const selectAllWithSameFill = useCallback(() => {
    setState((s) => {
      const firstId = s.selection[0];
      if (!firstId) return s;
      const first = s.document.nodes[firstId];
      if (!first) return s;
      const fills = resolveNodeFills(first);
      const candidates: NodeId[] = [];
      for (const [id, node] of Object.entries(s.document.nodes)) {
        if (id === firstId || !node || node.kind !== 'shape') continue;
        if ((node as SceneNode).locked || (node as SceneNode).visible === false) continue;
        const otherFills = resolveNodeFills(node as SceneNode);
        if (otherFills.length > 0 && fills.length > 0) {
          if (JSON.stringify(otherFills[0]) === JSON.stringify(fills[0])) {
            candidates.push(id);
          }
        }
      }
      return { ...s, selection: candidates };
    });
  }, [setState]);

  const selectAllWithSameLayerColor = useCallback(() => {
    setState((s) => {
      const firstId = s.selection[0];
      if (!firstId) return s;
      const first = s.document.nodes[firstId] as SceneNode | undefined;
      if (!first) return s;
      const color = first.layerColor;
      if (!color) return s;
      const candidates: NodeId[] = [];
      for (const [id, node] of Object.entries(s.document.nodes)) {
        if (
          node &&
          (node as SceneNode).layerColor === color &&
          !(node as SceneNode).locked &&
          (node as SceneNode).visible !== false
        ) {
          candidates.push(id);
        }
      }
      return { ...s, selection: candidates };
    });
  }, [setState]);

  const selectAllOfType = useCallback(() => {
    setState((s) => {
      const firstId = s.selection[0];
      if (!firstId) return s;
      const first = s.document.nodes[firstId];
      if (!first) return s;
      const kind = first.kind;
      const candidates: NodeId[] = [];
      for (const [id, node] of Object.entries(s.document.nodes)) {
        if (node && node.kind === kind) {
          candidates.push(id);
        }
      }
      return { ...s, selection: candidates };
    });
  }, [setState]);

  const value = useMemo<SelectionContextValue>(
    () => ({
      selection: state.selection,
      setSelection,
      toggleSelection,
      isSelected,
      selectedNodes,
      selectAllWithSameType,
      selectAllWithSameFill,
      selectAllWithSameLayerColor,
      selectAllOfType,
    }),
    [
      state.selection,
      setSelection,
      toggleSelection,
      isSelected,
      selectedNodes,
      selectAllWithSameType,
      selectAllWithSameFill,
      selectAllWithSameLayerColor,
      selectAllOfType,
    ],
  );

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}
