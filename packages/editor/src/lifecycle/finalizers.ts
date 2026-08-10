/**
 * Finalizer registry — bounded commit-phase cleanup (ADR-0216 D8).
 *
 * Finalizers run after user data is resolved and before the clean marker is
 * written. Every finalizer receives an AbortSignal and must not wait forever:
 * the registry enforces a total deadline, after which it stops starting new
 * finalizers and resolves (critical document persistence is user-controlled
 * in the save plan, never deadline-truncated here).
 */

import type { DirtyScope, Finalizer } from './types';

export interface FinalizerRegistry {
  register(finalizer: Finalizer): () => void;
  runFor(scope: DirtyScope): Promise<void>;
}

export interface FinalizerRegistryOptions {
  /** Total budget for one commit phase; default 5 s. */
  deadlineMs?: number;
  now?: () => number;
}

export function createFinalizerRegistry(options: FinalizerRegistryOptions = {}): FinalizerRegistry {
  const deadlineMs = options.deadlineMs ?? 5_000;
  const now = options.now ?? (() => Date.now());
  let finalizers: Finalizer[] = [];

  return {
    register(finalizer) {
      finalizers = [...finalizers, finalizer];
      return () => {
        finalizers = finalizers.filter((f) => f.id !== finalizer.id);
      };
    },
    async runFor(scope) {
      const start = now();
      const ordered = finalizers
        .filter((f) => f.scope === scope || f.scope === 'application')
        .sort((a, b) => a.priority - b.priority);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineMs));
      try {
        for (const finalizer of ordered) {
          if (controller.signal.aborted) break;
          const remaining = deadlineMs - (now() - start);
          if (remaining <= 0) break;
          try {
            await finalizer.finalize(controller.signal);
          } catch {
            // Optional finalizers never block commit; diagnostics surface
            // failures but the marker is still written for resolved data.
          }
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
