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

export interface GenerativeJobToken {
  id: string;
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

  start(sourceRevision: number): GenerativeJobToken {
    this.cancel();
    const controller = new AbortController();
    const token = {
      id: `generative-job-${++this.sequence}`,
      sourceRevision,
      signal: controller.signal,
    };
    this.active = { token, controller };
    this.state = {
      status: 'queued',
      jobId: token.id,
      sourceRevision,
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

  isCurrent(token: GenerativeJobToken, currentSourceRevision: number): boolean {
    return (
      this.active?.token.id === token.id &&
      this.active.token.sourceRevision === token.sourceRevision &&
      token.sourceRevision === currentSourceRevision &&
      !token.signal.aborted
    );
  }

  complete(token: GenerativeJobToken, currentSourceRevision: number): boolean {
    if (!this.isCurrent(token, currentSourceRevision)) return false;
    this.state = { ...this.state, status: 'completed', progress: 1 };
    this.active = null;
    return true;
  }

  fail(token: GenerativeJobToken, error: GenerativeEditError | Error): boolean {
    if (this.active?.token.id !== token.id) return false;
    this.state = {
      ...this.state,
      status: error.message === 'cancelled' ? 'cancelled' : 'error',
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

export function createGenerativeJobState(): GenerativeJobState {
  return { ...initialState };
}
