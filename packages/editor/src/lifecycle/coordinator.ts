/**
 * TerminationCoordinator — the single authoritative state machine for every
 * graceful termination request (ADR-0216 D1).
 *
 *   idle → checking → awaiting-user → saving → finalizing → committed
 *                    -> cancelled (back to idle)
 *
 * Idempotence: a request arriving during an active transaction joins it
 * instead of starting a second one. A broader intent (quit-application over
 * close-window over close-document) upgrades the scope mid-transaction: the
 * pending dialog is superseded and re-presented with the wider document set.
 *
 * The clean-shutdown marker is written ONLY after finalization completes —
 * "quit requested" never means "shutdown is clean".
 */

import {
  collectUnsavedDocuments,
  hasUnsavedDocuments,
  scopeForIntent,
  scopeSessionIds,
} from './dirtyRegistry';
import { createSavePlan, type SavePlan } from './savePlan';
import type {
  DialogOutcome,
  EditorLifecycleApi,
  FailureChoice,
  PromptKind,
  PromptRequest,
  QuitDocumentResult,
  SaveFailureCategory,
  TerminationIntent,
  TerminationPhase,
  TerminationResult,
  TerminationState,
  TerminationTraceEvent,
  UnsavedChoice,
  UnsavedDocument,
} from './types';

export interface LifecycleMarker {
  /** Read previous-session marker once and arm the current run as unclean. */
  begin(): boolean | null;
  previousSessionWasClean(): boolean | null;
  /** Written only after completed finalization. */
  markClean(): void;
}

export interface TerminationDialogs {
  /** Present unsaved-work UI. The host responds via `respond`; a later
   *  prompt with a higher promptId supersedes this one. */
  prompt(request: PromptRequest): void;
}

export interface FinalizerRunner {
  runFor(scope: 'document' | 'window' | 'application'): Promise<void>;
}

export interface TerminationCoordinatorDeps {
  api: EditorLifecycleApi;
  dialogs: TerminationDialogs;
  marker: LifecycleMarker;
  finalizers?: FinalizerRunner;
  /** Commit-time platform action (native close/exit, reload, restart).
   *  Returning `true` short-circuits the remaining commit pipeline (used by
   *  the updater's install-on-quit hook, which owns the exit itself). */
  onCommit?: (intent: TerminationIntent) => undefined | boolean | Promise<undefined | boolean>;
  /** Called at commit for intentionally discarded documents — the host
   *  removes their recovery snapshots (never while a dialog is open). */
  onDiscardCommitted?: (docs: UnsavedDocument[]) => void | Promise<void>;
  trace?: (event: TerminationTraceEvent) => void;
  savePlan?: SavePlan;
}

interface ActiveTransaction {
  intent: TerminationIntent;
  result: Promise<TerminationResult>;
}

const SCOPE_RANK: Record<string, number> = { document: 1, window: 2, application: 3 };

export class TerminationCoordinator {
  private deps: TerminationCoordinatorDeps;
  private phase: TerminationPhase = 'idle';
  private intent: TerminationIntent | null = null;
  private dirtyDocs: UnsavedDocument[] = [];
  private scopeIds: string[] = [];
  private failures: QuitDocumentResult[] = [];
  private tx: ActiveTransaction | null = null;
  private promptSeq = 0;
  private promptResolve: ((outcome: DialogOutcome | null) => void) | null = null;
  private listeners = new Set<(state: TerminationState) => void>();

  constructor(deps: TerminationCoordinatorDeps) {
    this.deps = deps;
  }

  /** All graceful termination requests converge here. Idempotent: joins an
   *  active transaction, upgrading the scope when the new intent is broader. */
  requestTermination(intent: TerminationIntent, source?: string): Promise<TerminationResult> {
    if (this.tx) {
      this.tryUpgrade(intent, source);
      return this.tx.result;
    }
    this.trace({ type: 'request', intent, source });
    const result = this.run(intent);
    this.tx = {
      intent,
      result: result.finally(() => {
        this.tx = null;
        this.phase = 'idle';
        this.intent = null;
        this.failures = [];
        this.notify();
      }),
    };
    return this.tx.result;
  }

  /** Live state for the dialog host and native bridge. */
  getState(): TerminationState {
    return {
      phase: this.phase,
      intent: this.intent,
      dirtyDocs: this.dirtyDocs,
      scopeSessionIds: this.scopeIds,
      failures: this.failures,
    };
  }

  subscribe(listener: (state: TerminationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  /** Whether unload handlers should warn the user right now. */
  shouldWarnOnUnload(): boolean {
    if (this.phase === 'committed') return false;
    if (this.phase !== 'idle') return true;
    return hasUnsavedDocuments(this.deps.api, 'application');
  }

  /** Best-effort unload flush (web): save dirty sessions without awaiting —
   *  recovery durability, not an unload dialog. */
  bestEffortFlush(): void {
    const docs = collectUnsavedDocuments(this.deps.api, 'application');
    for (const doc of docs) {
      void this.deps.api.saveSession(doc.sessionId);
    }
  }

  private async run(intent: TerminationIntent): Promise<TerminationResult> {
    this.phase = 'checking';
    this.intent = intent;
    const scope = scopeForIntent(intent);
    this.scopeIds = scopeSessionIds(this.deps.api, scope);
    this.dirtyDocs = collectUnsavedDocuments(this.deps.api, scope);
    this.trace({ type: 'scope', intent, scope, dirtyCount: this.dirtyDocs.length });
    this.notify();

    if (this.dirtyDocs.length === 0) {
      return this.commit(intent, []);
    }

    const plan = this.deps.savePlan ?? createSavePlan(this.deps.api);
    const choices = new Map<string, UnsavedChoice>();

    // ── unsaved-work resolution ─────────────────────────────────────────
    for (;;) {
      const outcome = await this.promptUser(this.dirtyDocs, intent, 'unsaved');
      if (outcome === undefined) continue; // superseded by a broader intent
      if (outcome === null) return this.cancel('user');
      choices.clear();
      for (const choice of outcome.choices) {
        if (this.dirtyDocs.some((d) => d.sessionId === choice.sessionId)) {
          if (choice.choice === 'save' || choice.choice === 'discard') {
            choices.set(choice.sessionId, choice.choice);
          }
        }
      }
      break;
    }

    // A document may have been saved externally (autosave) while the dialog
    // was open — only unresolved ones proceed.
    const toResolve = this.dirtyDocs.filter((d) => choices.has(d.sessionId));
    if (toResolve.length === 0) {
      return this.commit(intent, []);
    }

    this.phase = 'saving';
    this.notify();
    const saveable = toResolve.filter((d) => choices.get(d.sessionId) === 'save');
    const discardable = toResolve.filter((d) => choices.get(d.sessionId) === 'discard');
    const planResult = await plan.execute(saveable);
    this.failures = planResult.failures;
    this.notify();
    if (planResult.aborted) {
      return this.cancel('save-as-cancelled');
    }
    if (planResult.failures.length > 0) {
      return this.resolveFailures(intent, planResult.failures, discardable, plan);
    }
    return this.commit(intent, discardable);
  }

  // ── save-failure resolution ───────────────────────────────────────────
  private async resolveFailures(
    intent: TerminationIntent,
    failures: QuitDocumentResult[],
    discardable: UnsavedDocument[],
    plan: SavePlan,
  ): Promise<TerminationResult> {
    for (;;) {
      const docs: Array<UnsavedDocument & { failureCategory?: SaveFailureCategory }> = failures.map(
        (f) => {
          const doc = this.dirtyDocs.find((d) => d.sessionId === f.sessionId);
          return {
            sessionId: f.sessionId,
            name: doc?.name ?? f.sessionId,
            untitled: doc?.untitled ?? true,
            failureCategory: f.kind === 'failed' ? f.category : undefined,
          };
        },
      );
      const outcome = await this.promptUser(docs, intent, 'save-failed');
      if (outcome === undefined) continue;
      if (outcome === null) return this.cancel('user');
      const remaining: QuitDocumentResult[] = [];
      for (const choice of outcome.choices) {
        const doc = this.dirtyDocs.find((d) => d.sessionId === choice.sessionId);
        if (!doc) continue;
        switch (choice.choice as FailureChoice) {
          case 'discard':
            discardable.push(doc);
            break;
          case 'retry': {
            const rerun = await plan.execute([doc]);
            if (rerun.aborted) return this.cancel('save-as-cancelled');
            remaining.push(...rerun.failures);
            break;
          }
          case 'save-as': {
            const saved = await this.deps.api.saveSessionAs(doc.sessionId);
            if (!saved.ok) {
              remaining.push({
                kind: 'failed',
                sessionId: doc.sessionId,
                category: saved.cancelled
                  ? 'cancelled'
                  : this.deps.api.getLastSaveFailure(doc.sessionId),
              });
            }
            break;
          }
          case 'cancel':
            return this.cancel('user');
        }
      }
      if (remaining.length === 0) return this.commit(intent, discardable);
      failures = remaining;
      this.failures = failures;
      this.notify();
    }
  }

  // ── commit ────────────────────────────────────────────────────────────
  private async commit(
    intent: TerminationIntent,
    discarded: UnsavedDocument[],
  ): Promise<TerminationResult> {
    this.phase = 'finalizing';
    this.trace({ type: 'finalize', intent });
    this.notify();
    try {
      if (this.deps.finalizers) {
        await this.deps.finalizers.runFor(scopeForIntent(intent));
      }
      if (discarded.length > 0) {
        await this.deps.onDiscardCommitted?.(discarded);
      }
      // Clean marker only after required finalization completed.
      this.deps.marker.markClean();
      this.trace({ type: 'clean-marker' });
      this.phase = 'committed';
      this.trace({ type: 'commit', intent });
      this.notify();
      if (intent === 'close-document') {
        // Resolved documents close now; last tab returns to Home.
        for (const id of this.scopeIds) {
          this.deps.api.closeTab(id, true);
        }
      }
      await this.deps.onCommit?.(intent);
      return { outcome: 'committed' };
    } catch {
      // Finalization failed — the marker must NOT have been written by us;
      // the run stays recoverable, not falsely clean.
      this.phase = 'cancelled';
      this.trace({ type: 'cancel', reason: 'finalize-failed' });
      this.notify();
      return { outcome: 'failed', failures: this.failures };
    }
  }

  private cancel(reason: 'user' | 'save-as-cancelled' | 'finalize-failed'): TerminationResult {
    this.phase = 'cancelled';
    this.trace({ type: 'cancel', reason });
    this.notify();
    return { outcome: 'cancelled' };
  }

  // ── dialog plumbing ───────────────────────────────────────────────────
  private async promptUser(
    docs: Array<UnsavedDocument & { failureCategory?: SaveFailureCategory }>,
    intent: TerminationIntent,
    kind: PromptKind,
  ): Promise<DialogOutcome | null | undefined> {
    const id = ++this.promptSeq;
    this.promptResolve?.(null); // supersede any pending dialog
    this.phase = 'awaiting-user';
    this.trace({ type: 'dialog', kind, count: docs.length });
    this.notify();
    const outcome = await new Promise<DialogOutcome | null>((resolve) => {
      this.promptResolve = resolve;
      const request: PromptRequest = { promptId: id, docs, intent, kind, respond: resolve };
      this.deps.dialogs.prompt(request);
    });
    if (this.promptResolve === null || id !== this.promptSeq) {
      return undefined; // superseded
    }
    this.promptResolve = null;
    this.trace({ type: 'dialog-resolved', outcome: outcome === null ? 'cancel' : 'proceed' });
    return outcome;
  }

  private tryUpgrade(intent: TerminationIntent, source?: string): void {
    const current = this.intent;
    if (!current || current === intent) return;
    const nextRank = SCOPE_RANK[scopeForIntent(intent)] ?? 1;
    const currentRank = SCOPE_RANK[scopeForIntent(current)] ?? 1;
    if (nextRank <= currentRank) return;
    if (this.phase !== 'checking' && this.phase !== 'awaiting-user') return;
    this.intent = intent;
    const scope = scopeForIntent(intent);
    this.scopeIds = scopeSessionIds(this.deps.api, scope);
    this.dirtyDocs = collectUnsavedDocuments(this.deps.api, scope);
    this.trace({ type: 'request', intent, source });
    this.trace({ type: 'scope', intent, scope, dirtyCount: this.dirtyDocs.length });
    // Resolve the pending prompt as superseded — promptUser re-issues with
    // the upgraded document set on its next loop iteration.
    this.promptResolve?.(null);
    this.promptResolve = null;
    this.promptSeq++;
    this.notify();
  }

  private trace(event: TerminationTraceEvent): void {
    this.deps.trace?.(event);
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
