import type { NodeId } from '@varve/scene';
import type { PromptedMaskDiagnostics } from './promptedMaskValidation';

/**
 * Score provenance shown in diagnostics and the preview status. Legacy names
 * remain accepted while existing SAM2 sessions are migrated; neither legacy
 * nor current score is a probability of user intent.
 */
export type ObjectSelectionScoreSource =
  | 'predicted-iou'
  | 'stability'
  | 'heuristic'
  | 'model-iou'
  | 'activation-heuristic';

/** Transient Object Selection state. Never serialized or added to history. */
export interface ObjectSelectionSession {
  /** Document identity guards async results and prompt overlays. */
  documentId?: string;
  nodeId: NodeId;
  /** Identity of the complete candidate set produced by one inference run. */
  candidateSetId?: string;
  width: number;
  height: number;
  candidates: Array<{
    mask: Uint8Array;
    confidence: number;
    scoreSource?: ObjectSelectionScoreSource;
    /** Fraction of explicit point/box prompts satisfied, separate from IoU. */
    promptContainment?: number;
    /** Bounded topology/anchor evidence shown before the user applies a mask. */
    promptDiagnostics?: PromptedMaskDiagnostics;
  }>;
  /** Number of decoded masks rejected for failing explicit prompt geometry. */
  rejectedCandidateCount?: number;
  selectedCandidate: number;
  /** Exact candidate key that the user reviewed in the visible overlay. */
  reviewedCandidateKey?: string;
  /** Prompt markers in document/world coordinates for the canvas overlay. */
  points: Array<{ x: number; y: number; label: 0 | 1 }>;
  /** Box hint in document/world coordinates for the canvas overlay. */
  box: { x1: number; y1: number; x2: number; y2: number } | null;
  sourceLocator?: string;
  /** SHA-256 (or deterministic fallback) of the decoded source RGBA pixels. */
  sourceFingerprint?: string;
  /** Identity of the source-pixel to document-world mapping used for preview. */
  mappingFingerprint?: string;
  /** Point/box currently being drawn; never sent to the model until pointer-up. */
  draftPoint?: { x: number; y: number; label: 0 | 1 } | null;
  draftBox?: { x1: number; y1: number; x2: number; y2: number } | null;
  confidence: number;
  confidenceSource?: ObjectSelectionScoreSource;
  status: 'drawing' | 'previewing' | 'preparing' | 'encoding' | 'decoding' | 'ready' | 'error';
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  /** Wall-clock metadata for transient progress/diagnostics only. */
  startedAt?: number;
  slow?: boolean;
  stageTimingsMs?: Partial<Record<'preparing' | 'encoding' | 'decoding' | 'ready', number>>;
  modelId: string;
  executionProvider?: string;
  /** Human-readable capability routing decision for diagnostics and support. */
  routingReason?: string;
  routingRejections?: Array<{ providerId: string; reason: string }>;
}

/**
 * Return a stable, transient identity for the candidate currently shown to a
 * user. The source and mapping identities are deliberately part of the key:
 * reviewing a mask is not transferable across a changed image placement, even
 * when the candidate index happens to be the same. Candidate-set identity is
 * intentionally the only candidate-local input: confidence and diagnostic
 * fields may be refreshed while the same decoded mask remains on screen, and
 * that refresh must not silently revoke an otherwise valid review.
 */
export function objectSelectionCandidateReviewKey(
  session: Pick<
    ObjectSelectionSession,
    | 'candidateSetId'
    | 'startedAt'
    | 'sourceFingerprint'
    | 'mappingFingerprint'
    | 'modelId'
    | 'candidates'
  >,
  candidateIndex: number,
): string | null {
  const candidate = session.candidates[candidateIndex];
  if (!candidate || !Number.isSafeInteger(candidateIndex) || candidateIndex < 0) return null;
  const candidateSetId = session.candidateSetId ?? session.startedAt;
  if (!session.sourceFingerprint || candidateSetId == null) return null;
  return [
    session.sourceFingerprint,
    session.mappingFingerprint ?? '',
    session.modelId,
    candidateSetId,
    candidateIndex,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('|');
}
