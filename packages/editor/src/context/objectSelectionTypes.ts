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
    /** Computed once when the candidate is published; masks are then immutable. */
    maskFingerprint?: string;
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
  /** When the visible candidate review was confirmed, for audit/provenance. */
  reviewedCandidateAt?: number;
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
 * Return a stable, synchronous fingerprint of one decoded source-space mask.
 * This is a review identity, not an integrity or security hash. The two-lane
 * byte hash avoids turning a full-resolution mask into a large temporary
 * string while still binding review to every mask byte and its frame shape.
 */
export function objectSelectionCandidateMaskFingerprint(
  session: Pick<ObjectSelectionSession, 'width' | 'height' | 'candidates'>,
  candidateIndex: number,
): string | null {
  const candidate = session.candidates[candidateIndex];
  if (
    !candidate ||
    !Number.isSafeInteger(candidateIndex) ||
    candidateIndex < 0 ||
    !(candidate.mask instanceof Uint8Array)
  ) {
    return null;
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const mix = (value: number) => {
    h1 = Math.imul(h1 ^ value, 0x01000193);
    h2 = Math.imul(h2 ^ value, 0x85ebca6b);
  };
  const mixUint32 = (value: number) => {
    mix(value & 0xff);
    mix((value >>> 8) & 0xff);
    mix((value >>> 16) & 0xff);
    mix((value >>> 24) & 0xff);
  };

  mixUint32(session.width);
  mixUint32(session.height);
  mixUint32(candidate.mask.length);
  for (const byte of candidate.mask) mix(byte);
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export interface ObjectSelectionCandidateReviewKeyOptions {
  /** Re-read every current mask byte instead of trusting its publication identity. */
  verifyMask?: boolean;
}

/**
 * Return a stable, transient identity for the candidate currently shown to a
 * user. The source and mapping identities are deliberately part of the key:
 * reviewing a mask is not transferable across a changed image placement, even
 * when the candidate index happens to be the same. The exact candidate mask
 * is also part of the key, so a refreshed or mutated raster cannot inherit
 * approval from the pixels the user previously inspected. Confidence and
 * diagnostic fields may be refreshed while the same decoded mask remains on
 * screen, and that refresh alone does not revoke an otherwise valid review.
 */
export function objectSelectionCandidateReviewKey(
  session: Pick<
    ObjectSelectionSession,
    | 'candidateSetId'
    | 'startedAt'
    | 'sourceFingerprint'
    | 'mappingFingerprint'
    | 'modelId'
    | 'width'
    | 'height'
    | 'candidates'
  >,
  candidateIndex: number,
  options: ObjectSelectionCandidateReviewKeyOptions = {},
): string | null {
  const candidate = session.candidates[candidateIndex];
  if (!candidate || !Number.isSafeInteger(candidateIndex) || candidateIndex < 0) return null;
  const candidateSetId = session.candidateSetId ?? session.startedAt;
  if (!session.sourceFingerprint || candidateSetId == null) return null;
  const maskFingerprint = options.verifyMask
    ? objectSelectionCandidateMaskFingerprint(session, candidateIndex)
    : (candidate.maskFingerprint ??
      objectSelectionCandidateMaskFingerprint(session, candidateIndex));
  if (!maskFingerprint) return null;
  return [
    session.sourceFingerprint,
    session.mappingFingerprint ?? '',
    session.modelId,
    candidateSetId,
    candidateIndex,
    maskFingerprint,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('|');
}
