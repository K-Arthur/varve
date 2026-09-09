/**
 * useSelectionCommands — hook implementing hierarchy-navigation and
 * select-similar commands for the editor.
 *
 * Extracted from EditorProvider to keep context.tsx's complexity under
 * ceiling. Follows the context/useX.ts pattern: pure logic, no JSX.
 */

import type { NodeId } from '@varve/scene';
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from 'react';
import type { SelectionResult } from '../commands/selectionCommands';
import {
  invertSelectionCmd,
  selectAllChildrenCmd,
  selectAllWithSameBlendModeCmd,
  selectAllWithSameCornerRadiusCmd,
  selectAllWithSameFontCmd,
  selectAllWithSameOpacityCmd,
  selectAllWithSameStrokeCmd,
  selectChildrenCmd,
  selectNextSiblingCmd,
  selectParentCmd,
  selectPreviousSiblingCmd,
  selectSiblingsCmd,
} from '../commands/selectionCommands';
import { DEFAULT_SELECTION_ORIGIN, type EditorState, type SelectionOrigin } from './types';

interface SelectionCommandDeps {
  document: Parameters<typeof selectParentCmd>[0];
  primaryId: string | null;
  currentSelection: string[];
  patch: (patch: { selection?: string[]; primaryId?: string | null }) => void;
  announce: (msg: string) => void;
}

export function useSelectionCommands({
  document,
  primaryId,
  currentSelection,
  patch,
  announce,
}: SelectionCommandDeps) {
  const selectNone = useCallback(() => {
    patch({ selection: [], primaryId: null });
    announce('Selection cleared');
  }, [patch, announce]);

  const invertSelection = useCallback(() => {
    const { selection } = invertSelectionCmd(document, currentSelection);
    if (selection.length > 0) {
      patch({ selection, primaryId: selection[0] ?? null });
      announce(`Selected ${selection.length} nodes`);
    }
  }, [document, currentSelection, patch, announce]);

  const selectParent = useCallback(() => {
    const { selection, primaryId: next } = selectParentCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce('Selected parent');
    }
  }, [document, primaryId, patch, announce]);

  const selectChildren = useCallback(() => {
    const { selection, primaryId: next } = selectChildrenCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} children`);
    }
  }, [document, primaryId, patch, announce]);

  const selectSiblings = useCallback(() => {
    const { selection, primaryId: next } = selectSiblingsCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} siblings`);
    }
  }, [document, primaryId, patch, announce]);

  const selectNextSibling = useCallback(() => {
    const { selection, primaryId: next } = selectNextSiblingCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce('Selected next sibling');
    }
  }, [document, primaryId, patch, announce]);

  const selectPreviousSibling = useCallback(() => {
    const { selection, primaryId: next } = selectPreviousSiblingCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce('Selected previous sibling');
    }
  }, [document, primaryId, patch, announce]);

  const selectAllChildren = useCallback(() => {
    const { selection, primaryId: next } = selectAllChildrenCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} descendants`);
    }
  }, [document, primaryId, patch, announce]);

  const selectAllWithSameStroke = useCallback(() => {
    const { selection, primaryId: next } = selectAllWithSameStrokeCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} nodes with matching stroke`);
    }
  }, [document, primaryId, patch, announce]);

  const selectAllWithSameOpacity = useCallback(() => {
    const { selection, primaryId: next } = selectAllWithSameOpacityCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} nodes with matching opacity`);
    }
  }, [document, primaryId, patch, announce]);

  const selectAllWithSameBlendMode = useCallback(() => {
    const { selection, primaryId: next } = selectAllWithSameBlendModeCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} nodes with matching blend mode`);
    }
  }, [document, primaryId, patch, announce]);

  const selectAllWithSameFont = useCallback(() => {
    const { selection, primaryId: next } = selectAllWithSameFontCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} text nodes with matching font`);
    }
  }, [document, primaryId, patch, announce]);

  const selectAllWithSameCornerRadius = useCallback(() => {
    const { selection, primaryId: next } = selectAllWithSameCornerRadiusCmd(document, primaryId);
    if (selection.length > 0) {
      patch({ selection, primaryId: next });
      announce(`Selected ${selection.length} nodes with matching corner radius`);
    }
  }, [document, primaryId, patch, announce]);

  return {
    selectNone,
    invertSelection,
    selectParent,
    selectChildren,
    selectSiblings,
    selectNextSibling,
    selectPreviousSibling,
    selectAllChildren,
    selectAllWithSameStroke,
    selectAllWithSameOpacity,
    selectAllWithSameBlendMode,
    selectAllWithSameFont,
    selectAllWithSameCornerRadius,
  };
}

export type SelectionCommands = ReturnType<typeof useSelectionCommands>;
export type { SelectionResult };

interface SelectionHistoryLike {
  push(selection: string[]): void;
}

interface SelectionChangeRef {
  current: ((selection: NodeId[]) => void) | undefined;
}

/** Build the one-shot selection setter used by canvas and panel gestures. */
export function makeSetRefs(
  stateRef: MutableRefObject<EditorState>,
  setState: Dispatch<SetStateAction<EditorState>>,
  selectionHistory: SelectionHistoryLike,
  onSelectionChangeRef: SelectionChangeRef,
): (
  selection: readonly NodeId[],
  options?: { primary?: NodeId | null; origin?: SelectionOrigin },
) => void {
  return (selection, options) => {
    const current = stateRef.current;
    const nextSelection = [...new Set(selection)].filter((id) =>
      Boolean(current.document.nodes[id]),
    );
    if (JSON.stringify(current.selection) === JSON.stringify(nextSelection)) return;
    const primaryId =
      options?.primary && nextSelection.includes(options.primary)
        ? options.primary
        : (nextSelection[0] ?? null);
    const resolvedOrigin = options?.origin ?? DEFAULT_SELECTION_ORIGIN;
    if (resolvedOrigin !== 'api') selectionHistory.push(nextSelection);
    stateRef.current = {
      ...current,
      selection: nextSelection,
      primaryId,
      focusedNodeId: primaryId,
      selectionRevision: current.selectionRevision + 1,
      selectionOrigin: resolvedOrigin,
    };
    setState((state) => ({
      ...state,
      selection: nextSelection,
      primaryId,
      focusedNodeId: primaryId,
      selectionRevision: state.selectionRevision + 1,
      selectionOrigin: resolvedOrigin,
    }));
    onSelectionChangeRef.current?.(nextSelection);
  };
}
