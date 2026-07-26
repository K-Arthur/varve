import type { Document } from '@strata/scene';
import type { MatchResult, SearchOptions } from './types';

let requestCounter = 0;

type SearchCallback = {
  resolve: (results: {
    results: MatchResult[];
    skippedCount: { instances: number; locked: number; hidden: number };
  }) => void;
  reject: (err: Error) => void;
};

export class SearchWorkerHost {
  private worker: Worker | null = null;
  private pending = new Map<string, SearchCallback>();
  private supported = true;

  constructor() {
    try {
      this.worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.handleMessage(e);
      this.worker.onerror = () => {
        this.supported = false;
      };
    } catch {
      this.supported = false;
    }
  }

  private handleMessage(e: MessageEvent) {
    const msg = e.data;
    const cb = this.pending.get(msg.requestId);
    if (!cb) return;
    this.pending.delete(msg.requestId);
    if (msg.type === 'results') {
      cb.resolve({ results: msg.results, skippedCount: msg.skippedCount });
    } else if (msg.type === 'error') {
      cb.reject(new Error(msg.error));
    }
  }

  search(
    doc: Document,
    needle: string,
    options: SearchOptions,
    scope: 'selection' | 'page' | 'document',
    selection: readonly string[],
    excludeInstances: boolean,
    excludeLocked: boolean,
    excludeHidden: boolean,
  ): Promise<{
    results: MatchResult[];
    skippedCount: { instances: number; locked: number; hidden: number };
  }> {
    if (!this.supported || !this.worker) {
      return Promise.reject(new Error('Worker not available'));
    }

    return new Promise((resolve, reject) => {
      const requestId = `search_${++requestCounter}`;
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage({
        type: 'search',
        requestId,
        payload: {
          doc,
          needle,
          options,
          scope,
          selection,
          excludeInstances,
          excludeLocked,
          excludeHidden,
        },
      });
    });
  }

  cancel(requestId: string) {
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel', requestId });
    }
  }

  isAvailable(): boolean {
    return this.supported && this.worker !== null;
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
  }
}
