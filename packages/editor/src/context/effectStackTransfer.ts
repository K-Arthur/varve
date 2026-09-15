import {
  type Document,
  type EffectStackKind,
  type EffectStackTransferMode,
  type NodeId,
  transferEffectStackToNodes,
} from '@varve/scene';
import { isNodeEffectivelyLocked } from '../scene/world';

interface EffectStackCopyFeedback {
  sourceHasStack: boolean;
  requestedTargetCount: number;
  copiedTargetIds: NodeId[];
  skippedTargetCount: number;
  entryCount: number;
  omittedMaskCount: number;
  convertedBypassedObjectFilterCount: number;
  document: Document;
}

export interface EffectStackCopyActionOptions {
  updateDoc: (updater: (doc: Document) => Document) => void;
  invalidateThumbnail: (nodeId: NodeId) => void;
  announce: (message: string) => void;
  showToast: (message: string, type: 'info' | 'warning') => void;
}

/**
 * Keep layer-row stack transfer atomic and lock-aware. Scene owns cloning and
 * mask-cycle validation; this adapter owns the editor-facing result feedback.
 */
function copyEffectStackToUnlockedTargets(
  doc: Document,
  sourceNodeId: NodeId,
  targetNodeIds: readonly NodeId[],
  kind: EffectStackKind,
  mode: EffectStackTransferMode,
): EffectStackCopyFeedback {
  const requestedTargetIds = [...new Set(targetNodeIds)].filter((id) => id !== sourceNodeId);
  const unlockedTargetIds = requestedTargetIds.filter(
    (id) => !!doc.nodes[id] && !isNodeEffectivelyLocked(doc, id),
  );
  const transfer = transferEffectStackToNodes(doc, sourceNodeId, unlockedTargetIds, kind, mode);
  return {
    document: transfer.document,
    sourceHasStack: transfer.sourceHasStack,
    requestedTargetCount: requestedTargetIds.length,
    copiedTargetIds: transfer.copiedTargetIds,
    skippedTargetCount:
      transfer.skippedTargetIds.length + requestedTargetIds.length - unlockedTargetIds.length,
    entryCount: transfer.entryCount,
    omittedMaskCount: transfer.omittedMaskCount,
    convertedBypassedObjectFilterCount: transfer.convertedBypassedObjectFilterCount,
  };
}

/** Create the context action used by layer badge, drag/drop, and keyboard copy. */
export function createCopyEffectStackToNodes({
  updateDoc,
  invalidateThumbnail,
  announce,
  showToast,
}: EffectStackCopyActionOptions): (
  sourceNodeId: NodeId,
  targetNodeIds: NodeId[],
  kind: EffectStackKind,
  mode?: EffectStackTransferMode,
) => void {
  return (
    sourceNodeId: NodeId,
    targetNodeIds: NodeId[],
    kind: EffectStackKind,
    mode: EffectStackTransferMode = 'replace',
  ) => {
    // `updateDoc` intentionally exposes an asynchronous-looking callback
    // contract even though the updater runs synchronously. Keep the result in
    // an object so the document update and feedback remain one atomic action.
    const feedback: { current: EffectStackCopyFeedback | null } = { current: null };
    updateDoc((doc) => {
      feedback.current = copyEffectStackToUnlockedTargets(
        doc,
        sourceNodeId,
        targetNodeIds,
        kind,
        mode,
      );
      return feedback.current.document;
    });
    const transfer = feedback.current;
    if (!transfer?.sourceHasStack) {
      announce(
        `The source no longer has ${kind === 'layer-effects' ? 'Layer Effects' : 'Object Filters'} to copy`,
      );
      return;
    }
    if (transfer.copiedTargetIds.length === 0) {
      const message =
        transfer.requestedTargetCount === 0
          ? 'Select a destination layer, then activate the stack badge'
          : 'No compatible unlocked destination layers were found';
      announce(message);
      showToast(message, 'info');
      return;
    }

    for (const targetId of transfer.copiedTargetIds) invalidateThumbnail(targetId);
    const stackName = kind === 'layer-effects' ? 'Layer Effects' : 'Object Filters';
    const targetLabel = `${transfer.copiedTargetIds.length} layer${
      transfer.copiedTargetIds.length === 1 ? '' : 's'
    }`;
    announce(
      `${mode === 'append' ? 'Appended' : 'Copied'} ${transfer.entryCount} ${stackName} to ${targetLabel}`,
    );

    const notes: string[] = [];
    if (transfer.skippedTargetCount > 0) {
      notes.push(
        `${transfer.skippedTargetCount} incompatible, missing, or locked layer${
          transfer.skippedTargetCount === 1 ? ' was' : 's were'
        } skipped`,
      );
    }
    if (transfer.omittedMaskCount > 0) {
      notes.push(
        `${transfer.omittedMaskCount} invalid or cyclic effect mask${
          transfer.omittedMaskCount === 1 ? ' was' : 's were'
        } omitted`,
      );
    }
    if (transfer.convertedBypassedObjectFilterCount > 0) {
      notes.push(
        'the bypassed source filters were appended as disabled entries to preserve appearance',
      );
    }
    if (notes.length > 0) showToast(notes.join('; '), 'warning');
  };
}
