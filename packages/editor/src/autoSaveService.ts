/**
 * Auto-save service — periodic and idle-driven persistence of immutable
 * document revisions.
 *
 * The service deliberately never reads the active editor tab while a
 * background job is running. A revision captures its destination and
 * document before it is queued, so switching tabs or editing again cannot
 * make an older write land in the wrong file or clear newer work.
 */

import {
  createPersistenceRevision,
  type PersistenceRevision,
} from './persistence/documentRevision';

export interface AutoSaveConfig {
  intervalMs: number;
  idleThresholdMs: number;
  maxSaveRetries: number;
}

export type AutoSaveState = 'idle' | 'saving' | 'error';
export type AutoSaveStateCallback = (state: AutoSaveState, lastSavedAt: number | null) => void;
export type BackgroundSchedule = (job: () => void) => void;
export type AutoSaveRevision = PersistenceRevision;

const DEFAULTS: AutoSaveConfig = {
  intervalMs: 300000,
  idleThresholdMs: 2000,
  maxSaveRetries: 3,
};

export class AutoSaveService {
  private cfg: AutoSaveConfig;
  private readonly pending = new Map<string, AutoSaveRevision>();
  private readonly lastEditAt = new Map<string, number>();
  private readonly lastSavedAtBySession = new Map<string, number>();
  private _lastSavedAt: number | null = null;
  private _state: AutoSaveState = 'idle';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly stateCallbacks = new Set<AutoSaveStateCallback>();
  private onSaveRecovery: ((revision: AutoSaveRevision) => Promise<void>) | null = null;
  private saveQueued = false;
  private disposed = false;
  private disposeEpoch = 0;
  private inFlight: Promise<boolean> | null = null;
  private readonly legacyGetDocument:
    | (() => { document: PersistenceRevision['document']; meta: { fileId?: string; name: string } })
    | null;
  private readonly legacySaveFn: ((json: string) => Promise<boolean>) | null;

  constructor(
    saveFn: (revision: AutoSaveRevision, json: string) => Promise<boolean>,
    config?: Partial<AutoSaveConfig>,
    scheduleBackground?: BackgroundSchedule,
  );
  /** @deprecated Compatibility overload for callers migrating to revisions. */
  constructor(
    getDocument: () => {
      document: PersistenceRevision['document'];
      meta: { fileId?: string; name: string };
    },
    saveFn: (json: string) => Promise<boolean>,
    config?: Partial<AutoSaveConfig>,
    scheduleBackground?: BackgroundSchedule,
  );
  constructor(
    saveOrGetDocument:
      | ((revision: AutoSaveRevision, json: string) => Promise<boolean>)
      | (() => {
          document: PersistenceRevision['document'];
          meta: { fileId?: string; name: string };
        }),
    configOrSaveFn: Partial<AutoSaveConfig> | ((json: string) => Promise<boolean>) = {},
    scheduleOrConfig?: BackgroundSchedule | Partial<AutoSaveConfig>,
    legacySchedule?: BackgroundSchedule,
  ) {
    if (typeof configOrSaveFn === 'function') {
      this.legacyGetDocument = saveOrGetDocument as () => {
        document: PersistenceRevision['document'];
        meta: { fileId?: string; name: string };
      };
      this.legacySaveFn = configOrSaveFn;
      this.saveFn = async (_revision, json) => this.legacySaveFn?.(json) ?? false;
      this.cfg = { ...DEFAULTS, ...(scheduleOrConfig as Partial<AutoSaveConfig> | undefined) };
      this.scheduleBackground = legacySchedule ?? null;
    } else {
      this.legacyGetDocument = null;
      this.legacySaveFn = null;
      this.saveFn = saveOrGetDocument as (
        revision: AutoSaveRevision,
        json: string,
      ) => Promise<boolean>;
      this.cfg = { ...DEFAULTS, ...configOrSaveFn };
      this.scheduleBackground = (scheduleOrConfig as BackgroundSchedule | undefined) ?? null;
    }
  }

  private readonly saveFn: (revision: AutoSaveRevision, json: string) => Promise<boolean>;
  private readonly scheduleBackground: BackgroundSchedule | null;

  get lastSavedAt(): number | null {
    return this._lastSavedAt;
  }

  get state(): AutoSaveState {
    return this._state;
  }

  start(): void {
    if (this.disposed || this.intervalId !== null) return;
    this.intervalId = setInterval(() => this.check(), 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.saveQueued = false;
  }

  /** Stop scheduling and prevent queued/late callbacks from doing work. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      await this.inFlight;
      return;
    }
    this.disposed = true;
    this.disposeEpoch++;
    this.stop();
    await this.inFlight;
    this.pending.clear();
    this.lastEditAt.clear();
  }

  updateConfig(cfg: Partial<AutoSaveConfig>): void {
    if (this.disposed) return;
    this.cfg = { ...this.cfg, ...cfg };
  }

  onStateChange(callback: AutoSaveStateCallback): () => void {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  setOnSaveRecovery(fn: ((revision: AutoSaveRevision) => Promise<void>) | null): void;
  /** @deprecated Compatibility overload for pre-revision recovery callbacks. */
  setOnSaveRecovery(
    fn:
      | ((
          document: PersistenceRevision['document'],
          meta: { fileId?: string; name: string },
        ) => Promise<void>)
      | null,
  ): void;
  setOnSaveRecovery(
    fn:
      | ((revision: AutoSaveRevision) => Promise<void>)
      | ((
          document: PersistenceRevision['document'],
          meta: { fileId?: string; name: string },
        ) => Promise<void>)
      | null,
  ): void {
    if (fn === null) {
      this.onSaveRecovery = null;
      return;
    }
    this.onSaveRecovery = this.legacyGetDocument
      ? async (revision) =>
          (
            fn as (
              document: PersistenceRevision['document'],
              meta: { fileId?: string; name: string },
            ) => Promise<void>
          )(revision.document, { fileId: revision.fileId, name: revision.fileName })
      : (fn as (revision: AutoSaveRevision) => Promise<void>);
  }

  /** Register the newest immutable revision for one editor session. */
  notifyEdit(revision?: AutoSaveRevision): void {
    if (this.disposed) return;
    if (!revision && this.legacyGetDocument) {
      const current = this.legacyGetDocument();
      revision = createPersistenceRevision({
        sessionId: current.meta.fileId ?? 'legacy-session',
        projectId: current.meta.fileId ?? 'legacy-session',
        fileId: current.meta.fileId,
        fileName: current.meta.name,
        revision: Date.now(),
        document: current.document,
        capturedAt: Date.now(),
      });
      // The compatibility path intentionally keeps the old codec contract;
      // all production callers use the shared revision materializer.
      const legacyDocument = current.document;
      revision = { ...revision, materialize: () => JSON.stringify(legacyDocument) };
    }
    if (!revision) return;
    this.pending.set(revision.sessionId, revision);
    this.lastEditAt.set(revision.sessionId, revision.capturedAt);
  }

  /** Explicit save acknowledgement; only the exact revision may be removed. */
  acknowledgeSaved(sessionId: string, token: string): void {
    const current = this.pending.get(sessionId);
    if (current?.token === token) {
      this.pending.delete(sessionId);
      this.lastSavedAtBySession.set(sessionId, Date.now());
    }
  }

  discardSession(sessionId: string): void {
    this.pending.delete(sessionId);
    this.lastEditAt.delete(sessionId);
    this.lastSavedAtBySession.delete(sessionId);
  }

  /**
   * Save one session or all currently pending sessions immediately. Automatic
   * work still enters through the background frame lane.
   */
  async saveNow(sessionId?: string): Promise<boolean> {
    if (this.disposed || this._state === 'saving') return false;
    const revisions = sessionId
      ? [this.pending.get(sessionId)].filter((revision): revision is AutoSaveRevision => !!revision)
      : [...this.pending.values()];
    if (revisions.length === 0) return false;

    const epoch = this.disposeEpoch;
    const run = this.saveRevisions(revisions, epoch);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  private async saveRevisions(revisions: AutoSaveRevision[], epoch: number): Promise<boolean> {
    this.setState('saving');
    let allSucceeded = true;
    const maxAttempts = Math.max(1, this.cfg.maxSaveRetries);

    for (const revision of revisions) {
      if (this.disposed || epoch !== this.disposeEpoch) return false;
      let succeeded = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (this.disposed || epoch !== this.disposeEpoch) return false;
        try {
          // Materialization is memoized on the revision. A retry or a second
          // persistence service therefore never repeats the document walk.
          const json = revision.materialize();
          succeeded = await this.saveFn(revision, json);
          if (succeeded) break;
        } catch {
          // Keep the revision pending for the next interval/manual retry.
        }
        if (this.disposed || epoch !== this.disposeEpoch) return false;
      }
      if (!succeeded) {
        allSucceeded = false;
        continue;
      }

      this._lastSavedAt = Date.now();
      this.lastSavedAtBySession.set(revision.sessionId, this._lastSavedAt);
      if (this.pending.get(revision.sessionId)?.token === revision.token) {
        this.pending.delete(revision.sessionId);
      }
      if (this.onSaveRecovery && !this.disposed && epoch === this.disposeEpoch) {
        try {
          await this.onSaveRecovery(revision);
        } catch {
          // Recovery is best-effort and must not turn a successful save into
          // a retry of the document write.
        }
      }
    }

    this.setState(allSucceeded ? 'idle' : 'error');
    return allSucceeded;
  }

  private setState(state: AutoSaveState): void {
    if (this.disposed) return;
    this._state = state;
    for (const callback of this.stateCallbacks) callback(state, this._lastSavedAt);
  }

  private check(): void {
    if (this.disposed || this.pending.size === 0 || this._state === 'saving') return;
    const now = Date.now();
    const due = [...this.pending.values()].filter((revision) => {
      const lastEdit = this.lastEditAt.get(revision.sessionId) ?? revision.capturedAt;
      const lastSave = this.lastSavedAtBySession.get(revision.sessionId);
      return (
        now - lastEdit >= this.cfg.idleThresholdMs &&
        (lastSave === undefined || now - lastSave >= this.cfg.intervalMs)
      );
    });
    if (due.length === 0 || this.saveQueued) return;

    this.saveQueued = true;
    const epoch = this.disposeEpoch;
    const run = () => {
      this.saveQueued = false;
      if (this.disposed || epoch !== this.disposeEpoch) return;
      void this.saveNow();
    };
    if (this.scheduleBackground) this.scheduleBackground(run);
    else run();
  }
}
