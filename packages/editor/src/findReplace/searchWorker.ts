import type { Document } from '@strata/scene';
import { searchInDocument } from './search';
import type { MatchResult, SearchOptions } from './types';

interface SearchRequest {
  type: 'search';
  payload: {
    doc: Document;
    needle: string;
    options: SearchOptions;
    scope: 'selection' | 'page' | 'document';
    selection: readonly string[];
    excludeInstances: boolean;
    excludeLocked: boolean;
    excludeHidden: boolean;
  };
  requestId: string;
}

interface CancelRequest {
  type: 'cancel';
  requestId: string;
}

type WorkerRequest = SearchRequest | CancelRequest;

interface SearchResult {
  type: 'results';
  requestId: string;
  results: MatchResult[];
  skippedCount: { instances: number; locked: number; hidden: number };
}

interface SearchError {
  type: 'error';
  requestId: string;
  error: string;
}

const cancelled = new Set<string>();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.requestId);
    return;
  }

  if (msg.type === 'search') {
    const { payload } = msg;
    if (cancelled.has(msg.requestId)) {
      cancelled.delete(msg.requestId);
      return;
    }

    const _deadline = Date.now() + 5000;
    try {
      const { results, skippedCount } = searchInDocument(
        payload.doc,
        payload.needle,
        payload.options,
        payload.scope,
        payload.selection,
        payload.excludeInstances,
        payload.excludeLocked,
        payload.excludeHidden,
      );

      if (cancelled.has(msg.requestId)) {
        cancelled.delete(msg.requestId);
        return;
      }

      const response: SearchResult = {
        type: 'results',
        requestId: msg.requestId,
        results,
        skippedCount,
      };
      self.postMessage(response);
    } catch (err) {
      const response: SearchError = {
        type: 'error',
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : 'Search failed',
      };
      self.postMessage(response);
    }
  }
};
