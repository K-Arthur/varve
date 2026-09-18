/**
 * useLayerStructureCommands — the non-drag reparenting commands (indent /
 * outdent), extracted from LayersTree to keep it under its complexity
 * ceiling.
 *
 * Planning and the order model live in `layerIndentPlan.ts`; this hook owns
 * the interaction wiring: anchoring (roving focus or an explicit context
 * row), lock refusals, landing-container disclosure, one undo entry per
 * command, and the screen-reader announcements.
 *
 * Research basis: Krita's "move layer up/down … switches layers in and out
 * of groups" is the canonical non-drag reparent primitive; WCAG 2.5.7
 * requires a single-pointer non-drag alternative to grip dragging.
 */

import type { Document, NodeId } from '@varve/scene';
import { useCallback } from 'react';
import { getParentFast, type ParentIndexCache } from '../../scene/parentIndexCache';
import { isNodeEffectivelyLocked } from '../../scene/world';
import { containerForPlan, orderRootsForAppend, planIndent, planOutdent } from './layerIndentPlan';
import type { FlatEntry } from './useFlatTree';

interface UseLayerStructureCommandsArgs {
  doc: Document;
  entries: FlatEntry[];
  focusIdx: number;
  parentCacheRef: React.MutableRefObject<ParentIndexCache | null>;
  designCanvasId: NodeId | undefined;
  resolveMoveIds: (activeNodeId: NodeId) => NodeId[];
  reparentNode: (id: NodeId, parentId: NodeId | null, toIndex: number) => void;
  setExpanded: (update: (prev: Set<NodeId>) => Set<NodeId>) => void;
  announce: (message: string) => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
}

export function useLayerStructureCommands({
  doc,
  entries,
  focusIdx,
  parentCacheRef,
  designCanvasId,
  resolveMoveIds,
  reparentNode,
  setExpanded,
  announce,
  beginTransaction,
  commitTransaction,
}: UseLayerStructureCommandsArgs) {
  const indentSelection = useCallback(
    (nodeId?: NodeId) => {
      const anchorIdx = nodeId ? entries.findIndex((e) => e.node.id === nodeId) : focusIdx;
      const anchorEntry = entries[anchorIdx];
      if (!anchorEntry) return;
      const movedIds = resolveMoveIds(anchorEntry.node.id);
      if (movedIds.some((id) => isNodeEffectivelyLocked(doc, id))) {
        announce('Cannot move: locked by an ancestor layer');
        return;
      }
      const plan = planIndent(doc, entries, anchorIdx, movedIds, parentCacheRef.current);
      if (plan.kind === 'invalid') {
        announce(
          plan.reason === 'row-above-not-container'
            ? 'The layer above is not a container'
            : plan.reason === 'cycle'
              ? 'Cannot move a container into itself'
              : 'Nothing to indent into',
        );
        return;
      }
      if (plan.kind !== 'indent') return;
      const container = containerForPlan(doc, plan.containerId);
      if (!container) return;
      const targetName = container.name;
      // The destination must be open or the just-moved layers would vanish
      // (indenting into a collapsed or never-expanded container).
      setExpanded((prev) =>
        prev.has(plan.containerId) ? prev : new Set(prev).add(plan.containerId),
      );
      // Append back-most first so the roots keep their relative stacking
      // inside the container (children[] is back-to-front; the last append
      // becomes front-most).
      const appendOrder = orderRootsForAppend(entries, movedIds);
      beginTransaction();
      for (const id of appendOrder) {
        reparentNode(id, plan.containerId, container.children.length + appendOrder.length);
      }
      commitTransaction();
      announce(
        appendOrder.length > 1
          ? `Moved ${appendOrder.length} layers into ${targetName}`
          : `Moved ${anchorEntry.node.name} into ${targetName}`,
      );
    },
    [
      entries,
      focusIdx,
      announce,
      beginTransaction,
      commitTransaction,
      doc,
      parentCacheRef,
      reparentNode,
      resolveMoveIds,
      setExpanded,
    ],
  );

  const outdentSelection = useCallback(
    (nodeId?: NodeId) => {
      const anchorIdx = nodeId ? entries.findIndex((e) => e.node.id === nodeId) : focusIdx;
      const anchorEntry = entries[anchorIdx];
      if (!anchorEntry) return;
      const movedIds = resolveMoveIds(anchorEntry.node.id);
      if (movedIds.some((id) => isNodeEffectivelyLocked(doc, id))) {
        announce('Cannot move: locked by an ancestor layer');
        return;
      }
      // Only roots sharing the anchored root's container move together —
      // mixed-parent outdents land at per-parent targets, and one honest
      // command per container beats a silent multi-level reshuffle. Repeat
      // the command for the next group.
      const anchoredParentId = anchorEntry.parentId;
      const group = movedIds.filter(
        (id) => getParentFast(doc, id, parentCacheRef.current) === anchoredParentId,
      );
      const plans = group.map((id) => ({
        id,
        plan: planOutdent(doc, id, designCanvasId, parentCacheRef.current),
      }));
      if (plans.length === 0 || plans.some((p) => p.plan.kind !== 'outdent')) {
        announce('Already at the top level');
        return;
      }
      const previousParentName = anchoredParentId ? doc.nodes[anchoredParentId]?.name : undefined;
      beginTransaction();
      for (const { id, plan } of plans) {
        if (plan.kind !== 'outdent') continue;
        reparentNode(id, plan.parentId, plan.index);
      }
      commitTransaction();
      announce(
        plans.length > 1
          ? `Moved ${plans.length} layers out of ${previousParentName ?? 'the container'}`
          : `Moved ${anchorEntry.node.name} out of ${previousParentName ?? 'the container'}`,
      );
    },
    [
      entries,
      focusIdx,
      announce,
      beginTransaction,
      commitTransaction,
      designCanvasId,
      doc,
      parentCacheRef,
      reparentNode,
      resolveMoveIds,
    ],
  );

  return { indentSelection, outdentSelection };
}
