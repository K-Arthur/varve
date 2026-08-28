/**
 * The Knife cut as an editor command.
 *
 * `context.tsx` owns transactions, selection state and the announcer; the
 * geometry lives in `knifeSlice`. This is the piece between them — decide
 * whether there is anything to commit, what the selection becomes, and what to
 * say — and it lives here rather than inline in the provider because that file
 * is a 10k-line hub with an enforced line ceiling, and because a decision this
 * shaped is worth testing without mounting an editor.
 *
 * Pure: it computes an outcome and mutates nothing. The caller opens the
 * transaction, so a cut that divides nothing writes no history entry.
 */

import type { Document, NodeId } from '@varve/scene';
import { type KnifeLine, knifeSkipMessage, sliceDocumentWithKnife } from './knifeSlice';

export interface KnifeCutState {
  document: Document;
  selection: readonly NodeId[];
  selectionRevision: number;
}

/** Selection fields the provider patches after a successful cut. */
export interface KnifeSelectionPatch {
  selection: NodeId[];
  primaryId: NodeId | null;
  focusedNodeId: NodeId | null;
  selectionRevision: number;
  undoLabel: string;
  redoLabel: string;
}

export interface KnifeCutOutcome {
  /** The document to commit, or null when the cut divided nothing. */
  document: Document | null;
  /** Selection to apply alongside the commit, or null when nothing was cut. */
  patch: KnifeSelectionPatch | null;
  /** What to announce, whether or not anything was cut. */
  announcement: string;
}

export function runKnifeCut(line: KnifeLine, state: KnifeCutState): KnifeCutOutcome {
  const result = sliceDocumentWithKnife(state.document, line, state.selection);

  if (result.slicedNodeIds.length === 0) {
    // Nothing was cut. Say why, using the first object the cut actually
    // reached — "the knife did nothing" is not actionable, and the geometry
    // pass is the only thing that knows the reason.
    return { document: null, patch: null, announcement: knifeSkipMessage(result.skipped) };
  }

  const firstResultId = result.resultNodeIds[0] ?? null;
  const objects = result.slicedNodeIds.length;
  const pieces = result.resultNodeIds.length;
  // A cut that divided some objects and refused others still owes the user the
  // refusal: without it the missing piece looks like a bug rather than a rule.
  const skippedNote = result.skipped.length > 0 ? ` ${knifeSkipMessage(result.skipped)}` : '';

  return {
    document: result.document,
    patch: {
      // Every piece is selected in document order so it can be nudged, styled
      // or node-edited straight away.
      selection: result.resultNodeIds,
      primaryId: firstResultId,
      focusedNodeId: firstResultId,
      selectionRevision: state.selectionRevision + 1,
      undoLabel: 'Knife Slice',
      redoLabel: 'Redo',
    },
    announcement:
      objects === 1
        ? `Split into ${pieces} objects.${skippedNote}`
        : `Split ${objects} objects into ${pieces} pieces.${skippedNote}`,
  };
}
