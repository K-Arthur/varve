/**
 * Save plan — revision-safe, deduplicated per-document save resolution
 * (ADR-0216 D4).
 *
 * Rules enforced here:
 *  - one save at a time per session (the plan serializes its own writes);
 *  - a successful write marks a document clean only when the document is
 *    still at the saved revision — if an edit landed mid-save (revision
 *    race), the plan re-saves (bounded) instead of trusting the stale write;
 *  - Save As picker cancellation aborts the whole transaction — it is never
 *    interpreted as "discard";
 *  - a failed save is surfaced with a structured category, never a raw
 *    exception, and blocks termination until the user resolves it.
 */

import type {
  EditorLifecycleApi,
  QuitDocumentResult,
  SaveFailureCategory,
  UnsavedDocument,
} from './types';

export interface SavePlanResult {
  results: QuitDocumentResult[];
  failures: QuitDocumentResult[];
  /** True when a Save As picker was cancelled — the transaction must abort. */
  aborted: boolean;
}

export interface SavePlan {
  execute(docs: UnsavedDocument[]): Promise<SavePlanResult>;
}

export interface SavePlanOptions {
  /** Extra save attempts when a revision race is detected (total = 1 + n). */
  maxRetries?: number;
}

export function createSavePlan(api: EditorLifecycleApi, options: SavePlanOptions = {}): SavePlan {
  const maxRetries = options.maxRetries ?? 2;

  async function saveOne(doc: UnsavedDocument): Promise<QuitDocumentResult> {
    for (let attempt = 0; ; attempt++) {
      const outcome = await api.saveSession(doc.sessionId);
      if (!outcome.ok) {
        if (outcome.cancelled) {
          return { kind: 'cancelled', sessionId: doc.sessionId };
        }
        return {
          kind: 'failed',
          sessionId: doc.sessionId,
          category: api.getLastSaveFailure(doc.sessionId),
        };
      }
      if (!api.isSessionDirty(doc.sessionId)) {
        return { kind: 'saved', sessionId: doc.sessionId };
      }
      // Revision race: the document changed while the write was in flight.
      // The stale save must not mark the newer revision clean (§22).
      if (attempt >= maxRetries) {
        return {
          kind: 'failed',
          sessionId: doc.sessionId,
          category: 'conflict',
        };
      }
    }
  }

  return {
    async execute(docs) {
      const results: QuitDocumentResult[] = [];
      const failures: QuitDocumentResult[] = [];
      const seen = new Set<string>();
      for (const doc of docs) {
        if (seen.has(doc.sessionId)) continue;
        seen.add(doc.sessionId);
        const result = await saveOne(doc);
        results.push(result);
        if (result.kind === 'cancelled') {
          return { results, failures, aborted: true };
        }
        if (result.kind === 'failed') {
          failures.push(result);
        }
      }
      return { results, failures, aborted: false };
    },
  };
}

/** Map a raw persistence error to a structured category (M5 wires real
 *  classification in usePersistence; this is the fallback contract). */
export function categorizeFailure(_error: unknown): SaveFailureCategory {
  return 'unknown';
}
