/**
 * ConflictResolver — visual three-way merge conflict resolution (M12,
 * ADR-0035).
 *
 * Shows each conflict with its base/ours/theirs values, offers the
 * candidate resolutions the merge engine computed, and applies the user's
 * choices transactionally through `EditorHistorySession.completeMerge`.
 * Nothing is written until every conflict is resolved and the merge
 * completes — aborting the dialog leaves branches untouched.
 */

import type { MergeConflict, MergeResolution } from '@varve/history';
import { Dialog } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';

export interface ConflictResolverProps {
  open: boolean;
  branchName: string;
  conflicts: MergeConflict[];
  /** Called when the user clicks Cancel (no changes applied). */
  onClose: () => void;
  /** Called with the chosen resolutions to complete the merge. */
  onResolve: (resolutions: MergeResolution[]) => Promise<void>;
}

function shortValue(value: unknown): string {
  if (value === undefined) return '(none)';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 60)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{ ${entries
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${shortValue(v)}`)
      .join(', ')}${entries.length > 3 ? ', …' : ''} }`;
  }
  return String(value);
}

export function ConflictResolver({
  open,
  branchName,
  conflicts,
  onClose,
  onResolve,
}: ConflictResolverProps) {
  const [choices, setChoices] = useState<Record<string, 'ours' | 'theirs' | 'base'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // Default every conflict to the merge engine's recommended order.
      const defaults: Record<string, 'ours' | 'theirs' | 'base'> = {};
      for (const conflict of conflicts) {
        const preferred = conflict.candidateResolutions.includes('ours')
          ? 'ours'
          : conflict.candidateResolutions[0];
        if (preferred) defaults[conflict.conflictId] = preferred;
      }
      setChoices(defaults);
      setError(null);
    }
  }, [open, conflicts]);

  const setChoice = useCallback((conflictId: string, choice: 'ours' | 'theirs' | 'base') => {
    setChoices((prev) => ({ ...prev, [conflictId]: choice }));
  }, []);

  const handleComplete = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const resolutions: MergeResolution[] = Object.entries(choices).map(
        ([conflictId, choice]) => ({ conflictId, choice }),
      );
      await onResolve(resolutions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [choices, onResolve]);

  const resolvedCount = Object.values(choices).filter((c) => c !== undefined).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Resolve ${conflicts.length} merge conflict(s)`}
      size="lg"
    >
      <div className="conflict-resolver" data-testid="conflict-resolver">
        <h2 className="conflict-resolver__title">Merge conflicts with “{branchName}”</h2>
        <p className="conflict-resolver__subtitle" role="status" aria-live="polite">
          {resolvedCount} of {conflicts.length} conflicts resolved. The merge only completes after
          every conflict is resolved.
        </p>

        <ul className="conflict-resolver__list">
          {conflicts.map((conflict, index) => (
            <li
              key={conflict.conflictId}
              className="conflict-resolver__item"
              aria-label={`Conflict ${index + 1} of ${conflicts.length}: ${conflict.summary}`}
            >
              <div className="conflict-resolver__item-head">
                <span className="conflict-resolver__item-kind">{conflict.conflictKind}</span>
                <span className="conflict-resolver__item-summary">{conflict.summary}</span>
              </div>
              <div className="conflict-resolver__item-values">
                <div className="conflict-resolver__value conflict-resolver__value--base">
                  <span className="conflict-resolver__value-label">Base</span>
                  <code className="conflict-resolver__value-code">
                    {shortValue(conflict.baseValue)}
                  </code>
                </div>
                <div className="conflict-resolver__value conflict-resolver__value--ours">
                  <span className="conflict-resolver__value-label">Current</span>
                  <code className="conflict-resolver__value-code">
                    {shortValue(conflict.oursValue)}
                  </code>
                </div>
                <div className="conflict-resolver__value conflict-resolver__value--theirs">
                  <span className="conflict-resolver__value-label">Incoming</span>
                  <code className="conflict-resolver__value-code">
                    {shortValue(conflict.theirsValue)}
                  </code>
                </div>
              </div>
              <div
                className="conflict-resolver__item-choices"
                role="radiogroup"
                aria-label={`Choose resolution for conflict ${index + 1}`}
              >
                {conflict.candidateResolutions.map((candidate) => (
                  <label key={candidate} className="conflict-resolver__choice">
                    <input
                      type="radio"
                      name={conflict.conflictId}
                      checked={choices[conflict.conflictId] === candidate}
                      onChange={() => setChoice(conflict.conflictId, candidate)}
                    />
                    <span>
                      {candidate === 'ours'
                        ? 'Use current'
                        : candidate === 'theirs'
                          ? 'Use incoming'
                          : 'Use base'}
                    </span>
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <p className="conflict-resolver__error" role="alert">
            {error}
          </p>
        )}

        <div className="conflict-resolver__actions">
          <button
            type="button"
            className="conflict-resolver__btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="conflict-resolver__btn conflict-resolver__btn--primary"
            onClick={() => void handleComplete()}
            disabled={busy || resolvedCount !== conflicts.length}
          >
            {busy ? 'Merging…' : 'Complete merge'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
