/**
 * Findings registry — a tiny module-level store for the latest audit
 * findings, so navigation (deep links, "Go to finding") can resolve a
 * findingId without threading the IntelligencePanel's local report state
 * through the context.
 *
 * This is a single-slot cache, not a second context: producers call
 * `publishFindings` whenever a scan completes; consumers read the latest
 * snapshot with `getFindings` or subscribe for changes.
 */

import type { AuditFinding } from '@varve/scene';

let currentFindings: readonly AuditFinding[] = [];
const listeners = new Set<() => void>();

/** Publish the latest audit findings (call on scan completion). */
export function publishFindings(findings: readonly AuditFinding[]): void {
  currentFindings = findings;
  for (const listener of listeners) listener();
}

/** Latest published findings snapshot. */
export function getFindings(): readonly AuditFinding[] {
  return currentFindings;
}

/** Subscribe to findings changes; returns an unsubscribe function. */
export function subscribeFindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: clear the registry. */
export function resetFindingsRegistry(): void {
  currentFindings = [];
  listeners.clear();
}
