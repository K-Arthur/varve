/**
 * applyPatch — Pure utilities for the fix compute→apply cycle.
 *
 * Provides:
 * - `computeFix()` — run FixDescriptor.compute() and return the result
 * - `applyPatch()` — apply a Patch to a document snapshot (pure)
 * - `revalidateFix()` — re-compute a fix against a (potentially changed)
 *   document to check preconditions still hold
 *
 * These functions are framework-agnostic — they don't touch React, undo
 * history, or any editor state. The caller (e.g. an editor hook) is
 * responsible for wrapping apply in beginTransaction/commitTransaction.
 */

import type { FixDescriptor, FixKind, FixResult, Patch } from './auditTypes';

/**
 * Compute a fix without applying it.
 * Returns a FixResult containing a Patch that can be inspected, previewed,
 * or applied later.
 */
export function computeFix(descriptor: FixDescriptor, doc: unknown): FixResult {
  return descriptor.compute(doc);
}

/**
 * Apply a Patch to a document snapshot.
 * Pure function — returns a new document, does not mutate the input.
 *
 * IMPORTANT: The caller must verify preconditions against the live document
 * before calling applyPatch. Use revalidateFix() for that.
 */
export function applyPatch(doc: unknown, patch: Patch): unknown {
  return patch.apply(doc);
}

/**
 * Re-validate a fix against the current document.
 * Returns the re-computed FixResult. Useful before applying to ensure
 * the fix is still valid (the document may have changed since preview).
 */
export function revalidateFix(descriptor: FixDescriptor, currentDoc: unknown): FixResult {
  return descriptor.compute(currentDoc);
}

/**
 * Check whether two fix results conflict.
 * Two fixes conflict when they touch the same property on the same node.
 * Returns the first conflicting property, or null if no conflict.
 */
export function findFixConflict(
  a: FixResult,
  b: FixResult,
): { nodeId: string; property: string; aAfter: unknown; bAfter: unknown } | null {
  if (!a.ok || !b.ok) return null;

  for (const entryA of a.patch.affects) {
    for (const entryB of b.patch.affects) {
      if (entryA.nodeId !== entryB.nodeId) continue;
      for (const prop of entryA.properties) {
        if (entryB.properties.includes(prop)) {
          const changeA = a.summary.changes.find(
            (c) => c.nodeId === entryA.nodeId && c.property === prop,
          );
          const changeB = b.summary.changes.find(
            (c) => c.nodeId === entryB.nodeId && c.property === prop,
          );
          return {
            nodeId: entryA.nodeId,
            property: prop,
            aAfter: changeA?.after,
            bAfter: changeB?.after,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Merge multiple patches into one, applying them in order.
 * If any patch conflicts with a previously applied one, the conflicting
 * patches are excluded. The resulting patch applies only the non-conflicting
 * subset in deterministic order.
 *
 * Returns the merged Patch + a list of skipped patches with reasons.
 */
export function mergePatches(patches: Array<{ id: string; patch: Patch; kind: FixKind }>): {
  patch: Patch;
  skipped: Array<{ id: string; reason: string }>;
} {
  const applied: Array<{ id: string; patch: Patch }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const ordered = [...patches];

  for (const candidate of ordered) {
    let hasConflict = false;
    for (const appliedEntry of applied) {
      const fakeResult: FixResult = {
        ok: true,
        patch: appliedEntry.patch,
        affects: appliedEntry.patch.affects.map((a) => a.nodeId),
        summary: { changes: [] },
      };
      const fakeCandidate: FixResult = {
        ok: true,
        patch: candidate.patch,
        affects: candidate.patch.affects.map((a) => a.nodeId),
        summary: { changes: [] },
      };
      const conflict = findFixConflict(fakeResult, fakeCandidate);
      if (conflict) {
        hasConflict = true;
        skipped.push({
          id: candidate.id,
          reason: `conflict on ${conflict.nodeId}.${conflict.property}`,
        });
        break;
      }
    }

    if (!hasConflict) {
      applied.push({ id: candidate.id, patch: candidate.patch });
    }
  }

  const merged: Patch = {
    apply: (doc: unknown) => {
      let current = doc;
      for (const entry of applied) {
        current = entry.patch.apply(current);
      }
      return current;
    },
    affects: applied.flatMap((a) => a.patch.affects),
    summary: {
      changes: applied.flatMap((a) => a.patch.summary.changes),
    },
  };

  return { patch: merged, skipped };
}

/**
 * Compute a label for a fix result suitable for the undo stack.
 */
export function formatFixLabel(descriptor: FixDescriptor): string {
  return `Fix: ${descriptor.labelKey}`;
}

/**
 * Build a FixDescriptor from an AuditFix for backward compatibility.
 * Wraps the imperative `apply` function into the `compute` pattern.
 */
export function auditFixToDescriptor(
  fix: import('./auditTypes').AuditFix,
  labelKey: string,
): FixDescriptor {
  return {
    id: fix.id,
    labelKey,
    kind: fix.kind ?? 'safe',
    compute: (doc: unknown): FixResult => {
      try {
        const result = fix.apply(doc);
        if (result === null) {
          return {
            ok: false,
            reason: 'precondition-failed',
            detail: 'Fix would have no effect — issue already resolved.',
          };
        }
        return {
          ok: true,
          patch: {
            apply: () => result,
            affects: [],
            summary: { changes: [] },
          },
          affects: [],
          summary: { changes: [] },
        };
      } catch (e) {
        return {
          ok: false,
          reason: 'unsupported',
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
