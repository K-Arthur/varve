/**
 * CrashCenterController — framework-free orchestrator for the crash UI.
 *
 * Owns: consent provider, local queue, CrashReportService, breadcrumb
 * buffer, global error handlers, emergency-record import, and the UI state
 * surfaced to React components. Created once at app boot (App.tsx mounts
 * <CrashCenter/>); the settings section reads the same instance through
 * `getCrashController()`.
 *
 * Privacy invariants enforced here (in addition to the service):
 *  - handlers never throw and never re-enter capture;
 *  - capture metadata never includes document/layer/asset names;
 *  - the decision dialog is shown only for unknown/askEachTime consent;
 *  - a report is never shown twice in one session;
 *  - denying consent keeps recovery working (recovery is independent).
 */

import {
  type BreadcrumbSink,
  type ConsentAction,
  type CrashAttachment,
  CrashConsentProvider,
  type CrashConsentRecord,
  type CrashMetrics,
  type CrashReport,
  CrashReportQueue,
  CrashReportService,
  type CrashReportStorage,
  type CrashUploader,
  enterSafeMode,
  exitSafeMode,
  IndexedDbCrashReportStorage,
  isInCrashLoop,
  LocalCrashMetrics,
  LocalStorageCrashConsentStorage,
  LocalStorageCrashLoopStore,
  LocalStorageSafeModeStore,
  MemoryCrashReportStorage,
  MemorySafeModeStore,
  NoopCrashUploader,
  RingBreadcrumbBuffer,
  recordCleanStartup,
  recordStartupFailure,
  type SafeModeOptions,
  type SafeModeState,
  type SafeModeStore,
  updateSafeModeOptions,
} from '@varve/crash';
import { createNativeCrashStorage, listEmergencyRecords } from './nativeFsBridge';
import { getReleaseInfo, type ReleaseInfo } from './releaseInfo';

export type PlatformKind = 'tauri' | 'web' | 'memory';

export interface CrashUiState {
  consent: CrashConsentRecord;
  /** Newest report awaiting an explicit decision. */
  awaitingReport: CrashReport | null;
  /** Report open in the review-before-send dialog. */
  reviewingReport: CrashReport | null;
  queuedReports: CrashReport[];
  /** Report id of the last successfully sent report (for the receipt). */
  lastSentReportId: string | null;
  /** Last send failed — surface a retry affordance. */
  lastSendFailed: boolean;
  /** True while the safe-mode screen should be shown. */
  safeMode: SafeModeState | null;
  dialogVisible: boolean;
}

export interface CrashControllerDeps {
  platformKind: PlatformKind;
  /** Read the previous-session clean-shutdown marker exactly once at boot. */
  readUncleanShutdown: () => boolean;
  storageFactory?: () => Promise<CrashReportStorage>;
  uploader?: CrashUploader;
  metrics?: CrashMetrics;
  release?: ReleaseInfo;
  documentSchemaVersion?: number;
  isNetworkAvailable?: () => boolean;
  allowMetered?: () => boolean;
  /** Test hook: inject a pre-configured consent provider. */
  consentOverride?: CrashConsentProvider;
}

const EMPTY_UI: CrashUiState = {
  consent: { state: 'unknown', policyVersion: 1, decidedAt: 0, appVersion: '', scope: 'both' },
  awaitingReport: null,
  reviewingReport: null,
  queuedReports: [],
  lastSentReportId: null,
  lastSendFailed: false,
  safeMode: null,
  dialogVisible: false,
};

function localStorageLike(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    return window.localStorage;
  } catch {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
}

export class CrashCenterController {
  private readonly deps: CrashControllerDeps;
  private readonly release: ReleaseInfo;
  private readonly breadcrumbs: BreadcrumbSink = new RingBreadcrumbBuffer();
  private readonly placeholderQueue: CrashReportQueue;
  private service: CrashReportService;
  private ui: CrashUiState = { ...EMPTY_UI };
  private listeners = new Set<(state: CrashUiState) => void>();
  private shownReports = new Set<string>();
  private booted = false;
  private disposed = false;
  private handlersInstalled = false;
  private capturing = false;
  /** Per-session: crash-loop outcome is recorded once, even if StrictMode
   * remounts CrashCenter and boot() runs twice. */
  private loopRecorded = false;
  private consent!: CrashConsentProvider;
  private safeModeStore: SafeModeStore = new MemorySafeModeStore();

  constructor(deps: CrashControllerDeps) {
    this.deps = deps;
    this.release = deps.release ?? getReleaseInfo();
    const storage = localStorageLike();
    this.consent =
      deps.consentOverride ??
      new CrashConsentProvider(new LocalStorageCrashConsentStorage(storage), 'both');
    // Placeholder queue: pre-boot captures are held in memory and migrated
    // into the real storage by boot(). Reports never leave the device from
    // either queue without the consent gate.
    this.placeholderQueue = new CrashReportQueue(new MemoryCrashReportStorage());
    this.service = this.buildService(this.placeholderQueue);
  }

  private buildService(queue: CrashReportQueue): CrashReportService {
    const metrics = this.deps.metrics ?? new LocalCrashMetrics(localStorageLike());
    return new CrashReportService({
      consent: this.consent,
      queue,
      uploader: this.deps.uploader ?? new NoopCrashUploader(),
      metrics,
      appVersion: this.release.appVersion,
      buildChannel: this.release.buildChannel,
      releaseId: this.release.releaseId,
      gitCommit: this.release.gitCommit,
      documentSchemaVersion: this.deps.documentSchemaVersion ?? 0,
      runtime: this.deps.platformKind === 'tauri' ? 'tauri' : 'browser',
      scope: 'both',
      onAwaitingDecision: (report) => this.onAwaitingDecision(report),
      isNetworkAvailable: this.deps.isNetworkAvailable,
      allowMetered: this.deps.allowMetered,
    });
  }

  getState(): CrashUiState {
    return this.ui;
  }

  subscribe(listener: (state: CrashUiState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<CrashUiState>): void {
    this.ui = { ...this.ui, ...patch };
    for (const listener of this.listeners) listener(this.ui);
  }

  private async refreshQueued(): Promise<void> {
    const queued = await this.service.listQueued().catch(() => []);
    this.setState({ queuedReports: queued });
  }

  /** Installs global handlers and runs boot logic. Idempotent; re-arms
   * after dispose so StrictMode remounts work. */
  async boot(): Promise<void> {
    if (this.booted) {
      this.installWindowHandlers();
      return;
    }
    this.booted = true;
    this.disposed = false;

    // Crash-loop tracking: an unclean previous shutdown counts as a failure.
    // Recorded once per app session (StrictMode remounts must not double-
    // count a single crash).
    const loopStore = new LocalStorageCrashLoopStore(localStorageLike());
    if (!this.loopRecorded) {
      this.loopRecorded = true;
      const unclean = this.deps.readUncleanShutdown();
      if (unclean) {
        recordStartupFailure(loopStore);
      } else {
        recordCleanStartup(loopStore);
      }
    }
    if (isInCrashLoop(loopStore)) {
      this.safeModeStore = new LocalStorageSafeModeStore(localStorageLike());
      const state = enterSafeMode(this.safeModeStore, this.release.appVersion);
      this.setState({ safeMode: state, dialogVisible: false });
    }

    const storage = await this.initStorage();
    this.service = this.buildService(storage);
    // Migrate any pre-boot captures into the real queue.
    for (const report of await this.placeholderQueue.list()) {
      await storage.enqueue(report).catch(() => undefined);
      await this.placeholderQueue.delete(report.reportId);
    }
    await this.importEmergencyRecords();

    // Consent-gated startup sweep.
    if (this.service.getConsent().state === 'automaticAllowed') {
      void this.service.uploadPending();
    }

    await this.refreshQueued();
    this.maybeShowDecisionDialog();
    this.installWindowHandlers();
  }

  private async initStorage(): Promise<CrashReportQueue> {
    if (this.deps.platformKind === 'tauri') {
      const native = await createNativeCrashStorage();
      if (native) return new CrashReportQueue(native);
    }
    if (this.deps.platformKind !== 'memory' && typeof indexedDB !== 'undefined') {
      return new CrashReportQueue(new IndexedDbCrashReportStorage());
    }
    return new CrashReportQueue(new MemoryCrashReportStorage());
  }

  /** Converts native emergency records into consent-gated queued reports. */
  private async importEmergencyRecords(): Promise<void> {
    if (this.deps.platformKind !== 'tauri') return;
    const names = await listEmergencyRecords().catch(() => []);
    const storage = await createNativeCrashStorage().catch(() => null);
    if (!storage) return;
    for (const name of names) {
      try {
        const raw = await storage.load(name);
        if (!raw) continue;
        const record = JSON.parse(raw) as Record<string, unknown>;
        const crash = (record.crash ?? {}) as Record<string, unknown>;
        const report = await this.service.capture({
          type: crash.type === 'rust-panic' ? 'rust-panic' : 'fatal',
          category: String(crash.category ?? 'native-panic'),
          subsystem: 'native',
          message: String(crash.message ?? 'native panic'),
          rawStack: String(crash.reason ?? ''),
          threadCategory: 'native',
          recoveryStatus: 'not-applicable',
        });
        // The emergency record is consumed whether or not it queued.
        void storage.delete(name);
        void report;
      } catch {
        // Malformed records are left for expiration; never block startup.
      }
    }
  }

  private installWindowHandlers(): void {
    if (typeof window === 'undefined') return;
    if (this.handlersInstalled) return;
    this.handlersInstalled = true;
    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.addEventListener('webglcontextlost', this.handleContextLost);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  private readonly handleWindowError = (event: ErrorEvent): void => {
    if (this.capturing) return;
    this.capturing = true;
    try {
      const error = event.error;
      const stack = error instanceof Error ? (error.stack ?? '') : event.message;
      void this.captureCrash({
        type: 'error',
        category: 'window-error',
        subsystem: 'frontend',
        message: event.message || (error instanceof Error ? error.message : 'unknown error'),
        rawStack: stack,
        threadCategory: 'main',
        recoveryStatus: 'not-applicable',
      });
    } finally {
      this.capturing = false;
    }
  };

  private readonly handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (this.capturing) return;
    this.capturing = true;
    try {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'unhandled promise rejection';
      const stack = reason instanceof Error ? (reason.stack ?? '') : '';
      void this.captureCrash({
        type: 'unhandledrejection',
        category: 'unhandled-rejection',
        subsystem: 'frontend',
        message,
        rawStack: stack,
        threadCategory: 'main',
        recoveryStatus: 'not-applicable',
      });
    } finally {
      this.capturing = false;
    }
  };

  private readonly handleContextLost = (event: Event): void => {
    if (this.capturing) return;
    this.capturing = true;
    try {
      void this.captureCrash({
        type: 'contextlost',
        category: 'renderer-context-lost',
        subsystem: 'canvas',
        message: 'WebGL context lost',
        threadCategory: 'render',
        recoveryStatus: 'not-applicable',
      });
      if (event instanceof WebGLContextEvent && !event.defaultPrevented) {
        event.preventDefault();
      }
    } finally {
      this.capturing = false;
    }
  };

  private readonly handleBeforeUnload = (): void => {
    // Breadcrumbs are bounded in memory; nothing persists on unload.
    this.breadcrumbs.clear();
  };

  /** Public entry for workers/sub-systems (see crashTestHooks + worker hosts). */
  async captureCrash(input: {
    type:
      | 'error'
      | 'unhandledrejection'
      | 'react'
      | 'worker'
      | 'wasm'
      | 'contextlost'
      | 'oom'
      | 'hang'
      | 'fatal'
      | 'rust-panic';
    category: string;
    subsystem?: string;
    message: string;
    rawStack?: string;
    threadCategory: 'main' | 'worker' | 'render' | 'native' | 'wasm' | 'unknown';
    recoveryStatus: 'recovered' | 'not-recovered' | 'not-applicable';
    attachments?: CrashAttachment[];
  }): Promise<CrashReport | null> {
    this.breadcrumbs.record('crash.captured', input.category);
    const report = await this.service.capture({
      type: input.type,
      category: input.category,
      subsystem: input.subsystem,
      message: input.message,
      rawStack: input.rawStack,
      threadCategory: input.threadCategory,
      recoveryStatus: input.recoveryStatus,
      breadcrumbs: this.breadcrumbs.drain(),
      attachments: input.attachments,
    });
    await this.refreshQueued();
    return report;
  }

  private onAwaitingDecision(report: CrashReport): void {
    this.setState({ awaitingReport: report, dialogVisible: false });
    void this.refreshQueued();
    this.maybeShowDecisionDialog();
  }

  /** Shows the decision dialog once per report per session, when allowed. */
  private maybeShowDecisionDialog(): void {
    const consent = this.service.getConsent();
    if (consent.state !== 'unknown' && consent.state !== 'askEachTime') return;
    const report = this.ui.awaitingReport;
    if (!report || this.shownReports.has(report.reportId)) return;
    this.shownReports.add(report.reportId);
    this.setState({ dialogVisible: true });
  }

  /** Test-only: replaces the transport (see crashTestHooks). */
  setUploaderForTesting(uploader: CrashUploader): void {
    this.service.setUploaderForTesting(uploader);
  }

  // ---- Dialog actions -----------------------------------------------------

  closeDialog(): void {
    this.setState({ dialogVisible: false });
  }

  /** Recovery is never conditioned on reporting — this only dismisses. */
  proceedToRecovery(): void {
    this.setState({ dialogVisible: false });
    this.breadcrumbs.record('recovery.proceeded', 'recovery');
  }

  async sendAwaiting(withAutomatic = false): Promise<void> {
    const report = this.ui.awaitingReport;
    if (!report) return;
    this.breadcrumbs.record('crash.decision-send', 'consent');
    // One-time send records a decision; automatic is a separate explicit
    // opt-in that never happens silently.
    if (withAutomatic) {
      this.applyConsent('enableAutomatic');
    }
    const result = await this.service.sendOne(report.reportId);
    this.setState({ consent: this.service.getConsent() });
    if (result?.ok) {
      // Stay open to show the report-id receipt; awaitingReport is cleared.
      this.setState({
        lastSentReportId: report.reportId,
        lastSendFailed: false,
        awaitingReport: null,
        dialogVisible: true,
      });
      this.metricsRecord('dialogCompletion');
    } else {
      this.setState({ lastSendFailed: true });
    }
    await this.refreshQueued();
  }

  async declineAwaiting(): Promise<void> {
    const report = this.ui.awaitingReport;
    if (!report) return;
    await this.service.deleteQueued(report.reportId);
    this.setState({ awaitingReport: null, dialogVisible: false });
    await this.refreshQueued();
  }

  reviewAwaiting(): void {
    const report = this.ui.awaitingReport;
    if (!report) return;
    this.setState({ reviewingReport: report, dialogVisible: false });
  }

  closeReview(): void {
    // Back from review returns to the decision dialog when one is pending.
    this.setState({ reviewingReport: null, dialogVisible: this.ui.awaitingReport !== null });
  }

  async sendReviewing(): Promise<void> {
    const report = this.ui.reviewingReport;
    if (!report) return;
    const result = await this.service.sendOne(report.reportId);
    this.setState({ consent: this.service.getConsent() });
    if (result?.ok) {
      // Return to the decision dialog showing the report-id receipt.
      this.setState({
        reviewingReport: null,
        awaitingReport: null,
        dialogVisible: true,
        lastSentReportId: report.reportId,
        lastSendFailed: false,
      });
      this.metricsRecord('dialogCompletion');
    } else {
      this.setState({ lastSendFailed: true });
    }
    await this.refreshQueued();
  }

  applyConsent(action: ConsentAction): void {
    this.service.applyConsentAction(action);
    this.setState({ consent: this.service.getConsent() });
  }

  /** Set by the settings section; applies the three-way standing choice. */
  setStandingConsent(choice: 'askEachTime' | 'automaticAllowed' | 'denied'): void {
    if (choice === 'askEachTime') this.applyConsent('chooseAskEachTime');
    else if (choice === 'automaticAllowed') this.applyConsent('enableAutomatic');
    else this.applyConsent('deny');
    if (choice === 'automaticAllowed') {
      void this.service.uploadPending();
    }
  }

  async updateComment(comment: string): Promise<void> {
    const report = this.ui.reviewingReport;
    if (!report) return;
    const updated = await this.service.attachComment(report.reportId, comment);
    if (updated) this.setState({ reviewingReport: updated });
  }

  async updateContact(contact: string): Promise<void> {
    const report = this.ui.reviewingReport;
    if (!report) return;
    const updated = await this.service.attachContact(report.reportId, contact);
    if (updated) this.setState({ reviewingReport: updated });
  }

  async toggleAttachment(index: number): Promise<void> {
    const report = this.ui.reviewingReport;
    if (!report) return;
    const updated = await this.service.setAttachmentIncluded(
      report.reportId,
      index,
      !report.attachments[index]?.included,
    );
    if (updated) this.setState({ reviewingReport: updated });
  }

  async deleteQueued(id: string): Promise<void> {
    await this.service.deleteQueued(id);
    await this.refreshQueued();
  }

  /** Settings-section read path (fresh list, never throws). */
  async listQueuedForSettings(): Promise<CrashReport[]> {
    return this.service.listQueued().catch(() => []);
  }

  /** Settings-section send path: one-time send, denied state refuses. */
  async sendQueuedForSettings(id: string): Promise<void> {
    if (this.service.getConsent().state === 'denied') return;
    const result = await this.service.sendOne(id);
    this.setState({ consent: this.service.getConsent() });
    if (result?.ok) {
      this.setState({ lastSentReportId: id });
    }
    await this.refreshQueued();
  }

  async clearQueue(): Promise<void> {
    await this.service.clearQueue();
    await this.refreshQueued();
  }

  /** Builds a local support bundle (never transmitted automatically). */
  async exportSupportBundle(): Promise<string> {
    const reports = await this.service.listQueued().catch(() => []);
    const bundle = {
      generatedAt: new Date().toISOString(),
      appVersion: this.release.appVersion,
      buildChannel: this.release.buildChannel,
      releaseId: this.release.releaseId,
      consent: this.service.getConsent(),
      reports,
    };
    return JSON.stringify(bundle, null, 2);
  }

  // ---- Safe mode ----------------------------------------------------------

  updateSafeModeOption(option: keyof SafeModeOptions, value: boolean): void {
    const next = updateSafeModeOptions(this.safeModeStore, { [option]: value });
    if (next) this.setState({ safeMode: next });
  }

  exitSafeMode(): void {
    exitSafeMode(this.safeModeStore);
    this.setState({ safeMode: null });
  }

  continueInSafeMode(): void {
    this.setState({ dialogVisible: false });
  }

  private metricsRecord(event: 'dialogCompletion' | 'recoverySuccess' | 'safeModeRecovery'): void {
    // Metrics live on the service's metrics instance; best-effort only.
    try {
      const raw = localStorageLike().getItem('varve:crash-metrics');
      const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      parsed[event] = (parsed[event] ?? 0) + 1;
      localStorageLike().setItem('varve:crash-metrics', JSON.stringify(parsed));
    } catch {
      // ignore
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.booted = false;
    this.handlersInstalled = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('error', this.handleWindowError);
      window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
      window.removeEventListener('webglcontextlost', this.handleContextLost);
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }
  }
}
