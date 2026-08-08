/**
 * HistoryPanel — first-class registered panel for persistent revision
 * history (M8/M9/M10, ADR-0043/0044).
 *
 * Displays the revision step list, checkpoint/branch markers, and provides
 * navigation, checkpoint/branch creation, and comparison workflows.
 */

import type { BranchRef, CheckpointRef, MergeConflict } from '@varve/history';
import { EmptyState } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../context';
import type { HistoryStepView } from '../history/editorHistorySession';
import { ConflictResolver } from './ConflictResolver';

interface CompareChange {
  entityId: string;
  entityType: string;
  changeType: string;
  propertyPath?: string;
  summary: string;
}

/** Group a change list by persistent entity id, preserving change order. */
function groupByEntity(changes: CompareChange[]): Array<[string, CompareChange[]]> {
  const groups = new Map<string, CompareChange[]>();
  for (const change of changes) {
    const list = groups.get(change.entityId) ?? [];
    list.push(change);
    groups.set(change.entityId, list);
  }
  return [...groups.entries()];
}

export function HistoryPanel() {
  const editor = useEditor();
  const { persistentHistory } = editor;
  const session = persistentHistory.session;

  const [steps, setSteps] = useState<HistoryStepView[]>([]);
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointRef[]>([]);
  const [activeTab, setActiveTab] = useState<'steps' | 'branches' | 'compare'>('steps');
  const [searchQuery, setSearchQuery] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newCheckpointName, setNewCheckpointName] = useState('');
  const [showForm, setShowForm] = useState<'branch' | 'checkpoint' | null>(null);
  const [compareBase, setCompareBase] = useState('');
  const [compareTarget, setCompareTarget] = useState('');
  const [diffResult, setDiffResult] = useState<{
    added: number;
    removed: number;
    modified: number;
    renamed: number;
    reordered: number;
    text: number;
    changes: CompareChange[];
  } | null>(null);
  const [mergeTargetBranch, setMergeTargetBranch] = useState<BranchRef | null>(null);
  const [mergeConflicts, setMergeConflicts] = useState<MergeConflict[]>([]);
  const [mergeStatus, setMergeStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || !persistentHistory.attached) return;
    try {
      const [s, b, c] = await Promise.all([
        session.steps(),
        session.branches(),
        session.checkpoints(),
      ]);
      setSteps(s);
      setBranches(b);
      setCheckpoints(c);
    } catch {
      // session may be detached
    }
  }, [session, persistentHistory.attached, persistentHistory.version]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredSteps = useMemo(() => {
    if (!searchQuery) return steps;
    const q = searchQuery.toLowerCase();
    return steps.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.kind.toLowerCase().includes(q) ||
        s.origin.toLowerCase().includes(q) ||
        s.checkpointNames.some((n: string) => n.toLowerCase().includes(q)) ||
        s.branchHeadNames.some((n: string) => n.toLowerCase().includes(q)),
    );
  }, [steps, searchQuery]);

  const handleNavigate = useCallback(
    async (revisionId: string) => {
      if (!session) return;
      await session.checkout(revisionId);
      await refresh();
    },
    [session, refresh],
  );

  const handleCreateBranch = useCallback(async () => {
    if (!session || !newBranchName.trim()) return;
    try {
      await session.createBranch(newBranchName.trim());
      setNewBranchName('');
      setShowForm(null);
      await refresh();
    } catch (err) {
      console.warn('[history] create branch failed', err);
    }
  }, [session, newBranchName, refresh]);

  const handleCreateCheckpoint = useCallback(async () => {
    if (!session || !newCheckpointName.trim()) return;
    try {
      await session.addCheckpoint(newCheckpointName.trim());
      setNewCheckpointName('');
      setShowForm(null);
      await refresh();
    } catch (err) {
      console.warn('[history] create checkpoint failed', err);
    }
  }, [session, newCheckpointName, refresh]);

  const handleSwitchBranch = useCallback(
    async (branchId: string) => {
      if (!session) return;
      await session.switchBranch(branchId);
      await refresh();
    },
    [session, refresh],
  );

  const handleCompare = useCallback(async () => {
    if (!session || !compareBase || !compareTarget) return;
    const diff = await session.compareRevision(compareBase, compareTarget);
    if (diff) {
      setDiffResult({
        added: diff.summary.added,
        removed: diff.summary.removed,
        modified: diff.summary.modified,
        renamed: diff.summary.renamed,
        reordered: diff.summary.reordered,
        text: diff.summary.text,
        changes: diff.changes.map((c) => ({
          entityId: c.entityId,
          entityType: c.entityType,
          changeType: c.changeType,
          propertyPath: c.propertyPath,
          summary: c.summary,
        })),
      });
    }
  }, [session, compareBase, compareTarget]);

  /** Select a changed entity on the live canvas when it exists in the
   *  current working document. */
  const handleShowOnCanvas = useCallback(
    (entityId: string) => {
      const nodes = editor.state.document.nodes;
      if (nodes[entityId as keyof typeof nodes]) {
        editor.patch({ selection: [entityId as string], primaryId: entityId as string });
      }
    },
    [editor],
  );

  /** Start a merge of the current branch with the given branch. Opens the
   *  conflict resolver when the merge produces conflicts. */
  const handleMerge = useCallback(
    async (branch: BranchRef) => {
      if (!session) return;
      setMergeStatus(null);
      setMergeConflicts([]);
      const result = await session.mergeWithBranch(branch.branchId);
      if (!result) {
        setMergeStatus('No merge base found (unrelated histories?).');
        return;
      }
      if (result.status === 'clean') {
        setMergeStatus('Merge is clean — no conflicts.');
        return;
      }
      if (result.conflicts.length > 0) {
        setMergeTargetBranch(branch);
        setMergeConflicts(result.conflicts);
      } else {
        setMergeStatus('Merge produced no resolvable conflicts.');
      }
    },
    [session],
  );

  /** Complete the merge with the chosen resolutions (transactional). */
  const handleCompleteMerge = useCallback(
    async (resolutions: Array<{ conflictId: string; choice: 'ours' | 'theirs' | 'base' }>) => {
      if (!session || !mergeTargetBranch) return;
      const result = await session.completeMerge(mergeTargetBranch.branchId, resolutions);
      if (result.status === 'clean') {
        setMergeConflicts([]);
        setMergeTargetBranch(null);
        setMergeStatus(
          `Merge complete${result.revision ? ' — new revision has two parents' : ''}.`,
        );
        await refresh();
      } else {
        setMergeStatus(
          `Merge ${result.status}: ${result.warnings.join('; ') || 'see console for details'}`,
        );
        setMergeConflicts(result.conflicts ?? []);
      }
    },
    [session, mergeTargetBranch, refresh],
  );

  if (!persistentHistory.attached) {
    return (
      <div className="history-panel" data-testid="history-panel">
        <EmptyState
          illustration={null}
          headline="No history"
          description="Open a document to see revision history."
        />
      </div>
    );
  }

  return (
    <div className="history-panel" data-testid="history-panel">
      <div className="history-panel__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'steps'}
          className={`history-panel__tab ${activeTab === 'steps' ? 'history-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('steps')}
        >
          Steps
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'branches'}
          className={`history-panel__tab ${activeTab === 'branches' ? 'history-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('branches')}
        >
          Branches
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'compare'}
          className={`history-panel__tab ${activeTab === 'compare' ? 'history-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('compare')}
        >
          Compare
        </button>
      </div>

      {activeTab === 'steps' && (
        <div className="history-panel__content" role="tabpanel">
          <div className="history-panel__search">
            <input
              type="search"
              placeholder="Search history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="history-panel__search-input"
              aria-label="Search history"
            />
          </div>

          <div className="history-panel__actions">
            <button
              type="button"
              className="history-panel__action-btn"
              onClick={() => setShowForm('checkpoint')}
            >
              + Checkpoint
            </button>
            <button
              type="button"
              className="history-panel__action-btn"
              onClick={() => setShowForm('branch')}
            >
              + Branch
            </button>
          </div>

          {showForm === 'checkpoint' && (
            <div className="history-panel__form">
              <input
                type="text"
                placeholder="Checkpoint name"
                value={newCheckpointName}
                onChange={(e) => setNewCheckpointName(e.target.value)}
                className="history-panel__form-input"
                onKeyDown={(e) => e.key === 'Enter' && void handleCreateCheckpoint()}
              />
              <div className="history-panel__form-actions">
                <button type="button" onClick={() => void handleCreateCheckpoint()}>
                  Save
                </button>
                <button type="button" onClick={() => setShowForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showForm === 'branch' && (
            <div className="history-panel__form">
              <input
                type="text"
                placeholder="Branch name"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="history-panel__form-input"
                onKeyDown={(e) => e.key === 'Enter' && void handleCreateBranch()}
              />
              <div className="history-panel__form-actions">
                <button type="button" onClick={() => void handleCreateBranch()}>
                  Create
                </button>
                <button type="button" onClick={() => setShowForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="history-panel__steps">
            {filteredSteps.map((step) => (
              <button
                key={step.revision.revisionId}
                type="button"
                className={`history-panel__step ${step.isHead ? 'history-panel__step--head' : ''} ${
                  step.checkpointNames.length > 0 ? 'history-panel__step--checkpoint' : ''
                } ${step.branchHeadNames.length > 0 ? 'history-panel__step--branch' : ''}`}
                onClick={() => void handleNavigate(step.revision.revisionId)}
              >
                <div className="history-panel__step-main">
                  <span className="history-panel__step-label">{step.label}</span>
                  <span className="history-panel__step-kind">{step.kind}</span>
                </div>
                <div className="history-panel__step-markers">
                  {step.isHead && (
                    <span className="history-panel__marker history-panel__marker--head">HEAD</span>
                  )}
                  {step.checkpointNames.map((n: string) => (
                    <span
                      key={n}
                      className="history-panel__marker history-panel__marker--checkpoint"
                    >
                      {n}
                    </span>
                  ))}
                  {step.branchHeadNames.map((n: string) => (
                    <span key={n} className="history-panel__marker history-panel__marker--branch">
                      {n}
                    </span>
                  ))}
                </div>
                <div className="history-panel__step-meta">
                  <span className="history-panel__step-origin">{step.origin}</span>
                  {step.stepsBack > 0 && (
                    <span className="history-panel__step-distance">-{step.stepsBack}</span>
                  )}
                </div>
              </button>
            ))}
            {filteredSteps.length === 0 && (
              <EmptyState
                illustration={null}
                headline="No steps"
                description="Edit the document to see history steps."
              />
            )}
          </div>
        </div>
      )}

      {activeTab === 'branches' && (
        <div className="history-panel__content" role="tabpanel">
          <div className="history-panel__actions">
            <button
              type="button"
              className="history-panel__action-btn"
              onClick={() => setShowForm('branch')}
            >
              + New Branch
            </button>
          </div>

          {showForm === 'branch' && (
            <div className="history-panel__form">
              <input
                type="text"
                placeholder="Branch name"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="history-panel__form-input"
                onKeyDown={(e) => e.key === 'Enter' && void handleCreateBranch()}
              />
              <div className="history-panel__form-actions">
                <button type="button" onClick={() => void handleCreateBranch()}>
                  Create
                </button>
                <button type="button" onClick={() => setShowForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mergeStatus && (
            <div className="history-panel__merge-status" role="status" aria-live="polite">
              {mergeStatus}
            </div>
          )}

          <ul className="history-panel__branches">
            {branches.map((branch) => (
              <li
                key={branch.branchId}
                className={`history-panel__branch ${
                  session?.branch?.branchId === branch.branchId
                    ? 'history-panel__branch--current'
                    : ''
                }`}
              >
                <div className="history-panel__branch-main">
                  <span className="history-panel__branch-name">{branch.name}</span>
                  <span className="history-panel__branch-status">{branch.status}</span>
                </div>
                {session?.branch?.branchId !== branch.branchId && (
                  <div className="history-panel__branch-actions">
                    <button
                      type="button"
                      className="history-panel__branch-switch"
                      onClick={() => void handleSwitchBranch(branch.branchId)}
                    >
                      Switch
                    </button>
                    <button
                      type="button"
                      className="history-panel__branch-switch"
                      onClick={() => void handleMerge(branch)}
                    >
                      Merge
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h3 className="history-panel__section-title">Checkpoints</h3>
          <div className="history-panel__actions">
            <button
              type="button"
              className="history-panel__action-btn"
              onClick={() => setShowForm('checkpoint')}
            >
              + New Checkpoint
            </button>
          </div>

          {showForm === 'checkpoint' && (
            <div className="history-panel__form">
              <input
                type="text"
                placeholder="Checkpoint name"
                value={newCheckpointName}
                onChange={(e) => setNewCheckpointName(e.target.value)}
                className="history-panel__form-input"
                onKeyDown={(e) => e.key === 'Enter' && void handleCreateCheckpoint()}
              />
              <div className="history-panel__form-actions">
                <button type="button" onClick={() => void handleCreateCheckpoint()}>
                  Save
                </button>
                <button type="button" onClick={() => setShowForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="history-panel__checkpoints">
            {checkpoints.map((cp) => (
              <button
                key={cp.checkpointId}
                type="button"
                className="history-panel__checkpoint"
                onClick={() => void handleNavigate(cp.revisionId)}
              >
                <span className="history-panel__checkpoint-name">{cp.name}</span>
                {cp.pinned && (
                  <span className="history-panel__marker history-panel__marker--pinned">
                    Pinned
                  </span>
                )}
              </button>
            ))}
            {checkpoints.length === 0 && (
              <EmptyState
                illustration={null}
                headline="No checkpoints"
                description="Create a checkpoint to mark a revision."
              />
            )}
          </div>
        </div>
      )}

      {activeTab === 'compare' && (
        <div className="history-panel__content" role="tabpanel">
          <div className="history-panel__compare-form">
            <label className="history-panel__compare-label">
              Base revision:
              <select
                value={compareBase}
                onChange={(e) => setCompareBase(e.target.value)}
                className="history-panel__compare-select"
              >
                <option value="">Select base...</option>
                {steps.map((s) => (
                  <option key={s.revision.revisionId} value={s.revision.revisionId}>
                    {s.label} ({s.revision.revisionId.slice(0, 8)})
                  </option>
                ))}
              </select>
            </label>
            <label className="history-panel__compare-label">
              Target revision:
              <select
                value={compareTarget}
                onChange={(e) => setCompareTarget(e.target.value)}
                className="history-panel__compare-select"
              >
                <option value="">Select target...</option>
                {steps.map((s) => (
                  <option key={s.revision.revisionId} value={s.revision.revisionId}>
                    {s.label} ({s.revision.revisionId.slice(0, 8)})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="history-panel__compare-btn"
              onClick={() => void handleCompare()}
              disabled={!compareBase || !compareTarget}
            >
              Compare
            </button>
          </div>

          {diffResult && (
            <div className="history-panel__diff-result">
              <div className="history-panel__diff-summary" role="status" aria-live="polite">
                <div className="history-panel__diff-stat">
                  <span className="history-panel__diff-added">+{diffResult.added}</span>
                  <span className="history-panel__diff-removed">-{diffResult.removed}</span>
                  <span className="history-panel__diff-modified">~{diffResult.modified}</span>
                  {diffResult.renamed > 0 && (
                    <span className="history-panel__diff-renamed">↻{diffResult.renamed}</span>
                  )}
                  {diffResult.reordered > 0 && (
                    <span className="history-panel__diff-reordered">⇅{diffResult.reordered}</span>
                  )}
                  {diffResult.text > 0 && (
                    <span className="history-panel__diff-text">T{diffResult.text}</span>
                  )}
                </div>
              </div>

              {/* Changed-entity tree (M10): grouped by persistent entity id. */}
              <ul className="history-panel__entities">
                {groupByEntity(diffResult.changes).map(([entityId, changes]) => (
                  <li key={entityId} className="history-panel__entity">
                    <div className="history-panel__entity-head">
                      <span className="history-panel__entity-id" title={entityId}>
                        {entityId}
                      </span>
                      <span className="history-panel__entity-type">
                        {changes[0]?.entityType ?? ''}
                      </span>
                      <span className="history-panel__entity-count">{changes.length}</span>
                      <button
                        type="button"
                        className="history-panel__entity-show"
                        onClick={() => handleShowOnCanvas(entityId)}
                      >
                        Show on canvas
                      </button>
                    </div>
                    <ul className="history-panel__entity-changes">
                      {changes.map((change) => (
                        <li key={change.changeId} className="history-panel__entity-change">
                          <span
                            className={`history-panel__change-badge history-panel__change-badge--${change.changeType}`}
                          >
                            {change.changeType}
                          </span>
                          <span className="history-panel__change-summary">{change.summary}</span>
                          {change.propertyPath && (
                            <code className="history-panel__change-path">
                              {change.propertyPath}
                            </code>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {mergeTargetBranch && (
        <ConflictResolver
          open
          branchName={mergeTargetBranch.name}
          conflicts={mergeConflicts}
          onClose={() => {
            setMergeTargetBranch(null);
            setMergeConflicts([]);
          }}
          onResolve={(resolutions) => handleCompleteMerge(resolutions)}
        />
      )}
    </div>
  );
}
