import type { NodeId } from '@varve/scene';

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
  }>;
  selectedCandidate: number;
  points: Array<{ x: number; y: number; label: 0 | 1 }>;
  box: { x1: number; y1: number; x2: number; y2: number } | null;
  sourceLocator?: string;
  /** Point/box currently being drawn; never sent to the model until pointer-up. */
  draftPoint?: { x: number; y: number; label: 0 | 1 } | null;
  draftBox?: { x1: number; y1: number; x2: number; y2: number } | null;
  confidence: number;
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
}
