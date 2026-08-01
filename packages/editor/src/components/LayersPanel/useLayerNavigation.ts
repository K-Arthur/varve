import type { NodeId } from '@strata/scene';
import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from '../../context';
import { getParentFast, type ParentIndexCache } from '../../scene/parentIndexCache';
import type {
  LayerNavigationCommands,
  RevealOptions,
  RevealResult,
} from './layerNavigationCommands';
import { setLayerNavigationGetter } from './layerNavigationRegistry';

interface UseLayerNavigationOptions {
  expanded: Set<NodeId>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<NodeId>>>;
  parentCacheRef: React.MutableRefObject<ParentIndexCache | null>;
  virtualizerRef: React.MutableRefObject<{
    scrollToIndex: (index: number, options?: Record<string, unknown>) => void;
    getVirtualItems: () => Array<{ index: number }>;
  } | null>;
  entriesRef: React.MutableRefObject<Array<{ node: { id: NodeId } }>>;
  treeRef: React.MutableRefObject<HTMLDivElement | null>;
  focusIdxRef: React.MutableRefObject<number>;
  setFocusIdx: (idx: number) => void;
}

export function useLayerNavigation({
  expanded,
  setExpanded,
  parentCacheRef,
  virtualizerRef,
  entriesRef,
  treeRef,
  focusIdxRef,
  setFocusIdx,
}: UseLayerNavigationOptions) {
  const { state, setSelection, revealSelection } = useEditor();
  const stateRef = useRef(state);
  stateRef.current = state;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const revealNode = useCallback(
    (nodeId: NodeId, options?: RevealOptions): RevealResult => {
      const doc = stateRef.current.document;
      const node = doc.nodes[nodeId];
      if (!node) {
        return { found: false, ancestorExpansionRequired: false, expandedAncestorIds: [] };
      }

      const opts: Required<RevealOptions> = {
        select: true,
        fitViewport: true,
        temporaryExpansion: false,
        scrollToRow: true,
        focusPanel: false,
        ...options,
      };

      const expandedAncestorIds: NodeId[] = [];
      let changed = false;
      let parent = getParentFast(doc, nodeId, parentCacheRef.current);
      while (parent) {
        if (!expandedRef.current.has(parent)) {
          expandedAncestorIds.push(parent);
          changed = true;
        }
        parent = getParentFast(doc, parent, parentCacheRef.current);
      }

      if (changed) {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const id of expandedAncestorIds) {
            next.add(id);
          }
          return next;
        });
      }

      if (opts.select) {
        setSelection(nodeId, 'navigation');
      }

      requestAnimationFrame(() => {
        const virtualizer = virtualizerRef.current;
        const entries = entriesRef.current;
        if (!virtualizer || !entries) return;

        const idx = entries.findIndex((e) => e.node.id === nodeId);
        if (idx >= 0) {
          if (opts.scrollToRow) {
            virtualizer.scrollToIndex(idx, { align: 'auto' });
          }
          if (treeRef.current?.contains(document.activeElement)) {
            setFocusIdx(idx);
            focusIdxRef.current = idx;
          }
        }

        if (opts.fitViewport) {
          revealSelection({ nodeId, fit: true });
        }

        if (opts.focusPanel) {
          treeRef.current?.focus();
        }
      });

      return {
        found: true,
        ancestorExpansionRequired: changed,
        expandedAncestorIds,
      };
    },
    [
      setExpanded,
      setSelection,
      revealSelection,
      parentCacheRef,
      virtualizerRef,
      entriesRef,
      treeRef,
      focusIdxRef,
      setFocusIdx,
    ],
  );

  const revealFinding = useCallback(
    (nodeId: NodeId): RevealResult => {
      return revealNode(nodeId, { select: true, fitViewport: true, scrollToRow: true });
    },
    [revealNode],
  );

  const nodeExists = useCallback((nodeId: NodeId): boolean => {
    return stateRef.current.document.nodes[nodeId] !== undefined;
  }, []);

  const commands = useRef<LayerNavigationCommands>({ revealNode, revealFinding, nodeExists });
  commands.current = { revealNode, revealFinding, nodeExists };

  useEffect(() => {
    setLayerNavigationGetter(() => commands.current);
    return () => setLayerNavigationGetter(null);
  }, []);

  return { revealNode, revealFinding, nodeExists };
}
