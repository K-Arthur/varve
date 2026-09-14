/**
 * Subject-proposal state that survives Inspector scope switches.
 *
 * `SelectionSourcesPanel` is mounted in two different tree positions
 * depending on whether a pixel selection exists; React unmounts and remounts
 * it when the scope changes. Keeping the proposal set in component state
 * therefore erased the candidate list the moment the first proposal was
 * applied. This tiny external store keeps the proposals and their target
 * identity alive across remounts, and the target identity prevents a stale
 * proposal set from being offered for a different document or image.
 */
import type { ForegroundProposalSet } from '@varve/engine/foregroundSelect';
import type { NodeId } from '@varve/scene';

export interface SubjectProposalTarget {
  documentId: string;
  nodeId: NodeId;
}

export interface SubjectProposalState {
  target: SubjectProposalTarget | null;
  proposals: ForegroundProposalSet | null;
  busy: boolean;
}

let state: SubjectProposalState = { target: null, proposals: null, busy: false };
const listeners = new Set<() => void>();

export function getSubjectProposalState(): SubjectProposalState {
  return state;
}

export function subscribeSubjectProposals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSubjectProposalState(next: Partial<SubjectProposalState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Clear proposals and busy state; used by tests and document teardown. */
export function resetSubjectProposals(): void {
  setSubjectProposalState({ target: null, proposals: null, busy: false });
}
