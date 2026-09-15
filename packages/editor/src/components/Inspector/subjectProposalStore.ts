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
 *
 * It also keeps the provider decision and install offer so the panel can
 * explain what actually ran (or what needs installing) after a remount.
 */
import type { ForegroundProposalSet } from '@varve/engine/foregroundSelect';
import type { SubjectProposalQuality, SubjectProposalSource } from '@varve/engine/subjectProposal';
import type { NodeId } from '@varve/scene';

export interface SubjectProposalTarget {
  documentId: string;
  nodeId: NodeId;
  /** Resolved source locator captured before inference began. */
  sourceLocator: string;
  /** Natural source dimensions captured with the reviewed proposal. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Exact decoded RGBA fingerprint captured before inference began. */
  sourceFingerprint?: string;
  /** Canonical source-pixel to document-world mapping used by the proposal. */
  mappingFingerprint?: string;
}

export interface SubjectProposalProviderInfo {
  source: SubjectProposalSource;
  label: string;
  modelId: string | null;
  quality: SubjectProposalQuality;
  /** True when the requested quality model could not run and a lighter one did. */
  steppedDown: boolean;
  /** Model attempts that failed before this result, with reasons. */
  failed: Array<{ modelId: string; reason: string }>;
}

export interface SubjectProposalInstallOffer {
  modelId: 'isnet-general-use' | 'birefnet-general-lite' | 'modnet-portrait';
  displayName: string;
  downloadBytes: number;
}

export interface SubjectProposalState {
  target: SubjectProposalTarget | null;
  proposals: ForegroundProposalSet | null;
  provider: SubjectProposalProviderInfo | null;
  install: SubjectProposalInstallOffer | null;
  /** Candidate currently shown in the canvas review overlay, or -1 before preview. */
  activeCandidate: number;
  /** Candidate explicitly reviewed by the user, or null before review. */
  reviewedCandidate: number | null;
  /** Exact source/mapping/candidate-pixel identity approved by the user. */
  reviewedCandidateKey: string | null;
  busy: boolean;
  /** Coarse stage for user-facing progress copy. */
  stage: 'idle' | 'preparing' | 'estimating' | 'downloading';
  /** Download progress 0..1 when `stage === 'downloading'`. */
  downloadProgress: number | null;
  error: string | null;
}

let state: SubjectProposalState = {
  target: null,
  proposals: null,
  provider: null,
  install: null,
  activeCandidate: -1,
  reviewedCandidate: null,
  reviewedCandidateKey: null,
  busy: false,
  stage: 'idle',
  downloadProgress: null,
  error: null,
};

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
  state = {
    target: null,
    proposals: null,
    provider: null,
    install: null,
    activeCandidate: -1,
    reviewedCandidate: null,
    reviewedCandidateKey: null,
    busy: false,
    stage: 'idle',
    downloadProgress: null,
    error: null,
  };
  for (const listener of listeners) listener();
}
