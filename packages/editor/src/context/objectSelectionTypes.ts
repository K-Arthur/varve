import type { NodeId } from '@varve/scene';

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
  width: number;
  height: number;
  candidates: Array<{
    mask: Uint8Array;
    confidence: number;
    scoreSource?: ObjectSelectionScoreSource;
    /** Fraction of explicit point/box prompts satisfied, separate from IoU. */
    promptContainment?: number;
  }>;
  /** Number of decoded masks rejected for failing explicit prompt geometry. */
  rejectedCandidateCount?: number;
  selectedCandidate: number;
  points: Array<{ x: number; y: number; label: 0 | 1 }>;
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
