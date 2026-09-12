import type { GenerativeEditError } from './types';

export type GenerativeJobStatus =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'generating'
  | 'compositing'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface GenerativeJobState {
  status: GenerativeJobStatus;
  jobId: string | null;
  sourceRevision: number | null;
  progress: number;
  error: GenerativeEditError | Error | null;
}

/** Immutable identity captured when a generation request is admitted. */
export interface GenerativeJobSnapshot {
  documentId: string;
  targetId: string;
  sourceRevision: number;
  sourceAssetId: string | null;
  sourceHash: string;
  placementFingerprint: string;
  maskRevision: number;
  settingsFingerprint: string;
  outputFrameFingerprint: string;
}

export interface GenerativeJobToken {
  id: string;
  snapshot: GenerativeJobSnapshot;
  sourceRevision: number;
  signal: AbortSignal;
}

const initialState: GenerativeJobState = {
  status: 'idle',
  jobId: null,
  sourceRevision: null,
  progress: 0,
  error: null,
};

/**
 * Owns cancellation and identity for one editor surface. A result is current
 * only while both its job id and source revision still match.
 */
export class GenerativeJobController {
  private sequence = 0;
  private active: { token: GenerativeJobToken; controller: AbortController } | null = null;
  private state: GenerativeJobState = initialState;

  getState(): GenerativeJobState {
    return this.state;
  }

  start(source: GenerativeJobSnapshot | number): GenerativeJobToken {
    this.cancel();
    const controller = new AbortController();
    const snapshot = normalizeSnapshot(source);
    const token = {
      id: `generative-job-${++this.sequence}`,
      snapshot,
      sourceRevision: snapshot.sourceRevision,
      signal: controller.signal,
    };
    this.active = { token, controller };
    this.state = {
      status: 'queued',
      jobId: token.id,
      sourceRevision: snapshot.sourceRevision,
      progress: 0,
      error: null,
    };
    return token;
  }

  update(
    progress: number,
    status: Extract<GenerativeJobStatus, 'preparing' | 'generating' | 'compositing'>,
  ): void {
    if (!this.active) return;
    this.state = { ...this.state, status, progress: Math.max(0, Math.min(1, progress)) };
  }

  isCurrent(token: GenerativeJobToken, current: GenerativeJobSnapshot | number): boolean {
    const currentSnapshot = normalizeSnapshot(current);
    return (
      this.active?.token.id === token.id &&
      this.active.token.sourceRevision === token.sourceRevision &&
      snapshotsEqual(token.snapshot, currentSnapshot) &&
      !token.signal.aborted
    );
  }

  complete(token: GenerativeJobToken, current: GenerativeJobSnapshot | number): boolean {
    if (!this.isCurrent(token, current)) return false;
    this.state = { ...this.state, status: 'completed', progress: 1 };
    this.active = null;
    return true;
  }

  fail(token: GenerativeJobToken, error: GenerativeEditError | Error): boolean {
    if (this.active?.token.id !== token.id) return false;
    const code = (error as Error & { code?: unknown }).code;
    this.state = {
      ...this.state,
      status:
        code === 'cancelled' || error.message.toLowerCase() === 'cancelled' ? 'cancelled' : 'error',
      error,
    };
    this.active = null;
    return true;
  }

  cancel(): void {
    if (!this.active) return;
    this.active.controller.abort();
    this.state = { ...this.state, status: 'cancelled' };
    this.active = null;
  }
}

function normalizeSnapshot(source: GenerativeJobSnapshot | number): GenerativeJobSnapshot {
  if (typeof source !== 'number') return source;
  return {
    documentId: '',
    targetId: '',
    sourceRevision: source,
    sourceAssetId: null,
    sourceHash: '',
    placementFingerprint: '',
    maskRevision: 0,
    settingsFingerprint: '',
    outputFrameFingerprint: '',
  };
}

function snapshotsEqual(left: GenerativeJobSnapshot, right: GenerativeJobSnapshot): boolean {
  return (
    left.documentId === right.documentId &&
    left.targetId === right.targetId &&
    left.sourceRevision === right.sourceRevision &&
    left.sourceAssetId === right.sourceAssetId &&
    left.sourceHash === right.sourceHash &&
    left.placementFingerprint === right.placementFingerprint &&
    left.maskRevision === right.maskRevision &&
    left.settingsFingerprint === right.settingsFingerprint &&
    left.outputFrameFingerprint === right.outputFrameFingerprint
  );
}

export function createGenerativeJobState(): GenerativeJobState {
  return { ...initialState };
}
