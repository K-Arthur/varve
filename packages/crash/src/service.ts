/**
 * CrashReportService — the consent-gated orchestrator.
 *
 * Flow: capture → redaction (before ANY storage) → local queue → consent
 * gate → optional upload. Unknown consent never uploads. "Send one report"
 * never enables automatic reporting. Revocation stops pending uploads
 * immediately (aborts in-flight requests and refuses further attempts).
 *
 * The service is provider-independent: the uploader is injected and defaults
 * to a no-op, so no network activity can exist before consent. All consent
 * lookups are synchronous; every upload attempt re-checks consent at the
 * moment of dispatch.
 */

import type { ConsentProvider, ConsentScope, CrashConsentRecord } from './consent';
import { type ConsentAction, canAsk, canUpload } from './consent';
import { collectCrashContext } from './context';
import type { CrashMetrics } from './metrics';
import type { CrashReportQueue } from './queue';
import { sanitizeCrashReport, toUploadPayload } from './redact';
import type {
  CrashAttachment,
  CrashBreadcrumb,
  CrashReport,
  CrashRuntimeMetadata,
  CrashThreadCategory,
  CrashType,
  RecoveryStatus,
  RuntimeKind,
} from './schema';
import { LIMITS } from './schema';
import type { CrashUploader, CrashUploadResult } from './uploader';

export type BuildChannel = 'dev' | 'nightly' | 'beta' | 'production';

export interface RawCaptureInput {
  type: CrashType;
  category: string;
  subsystem?: string;
  message: string;
  rawStack?: string;
  threadCategory: CrashThreadCategory;
  reason?: string;
  recoveryStatus: RecoveryStatus;
  breadcrumbs?: CrashBreadcrumb[];
  attachments?: CrashAttachment[];
  userComment?: string;
  userContact?: string;
}

export interface CrashServiceDeps {
  consent: ConsentProvider;
  queue: CrashReportQueue;
  uploader: CrashUploader;
  metrics?: CrashMetrics;
  appVersion: string;
  buildChannel: BuildChannel;
  releaseId: string;
  documentSchemaVersion: number;
  runtime: RuntimeKind;
  osFamily?: CrashRuntimeMetadata['osFamily'];
  osVersionRange?: string;
  arch?: CrashRuntimeMetadata['arch'];
  rendererBackend?: CrashRuntimeMetadata['rendererBackend'];
  tauriVersion?: string;
  frontendBundleVersion?: string;
  gitCommit?: string;
  scope: ConsentScope;
  /** Invoked when a captured report awaits an explicit consent decision. */
  onAwaitingDecision?: (report: CrashReport) => void;
  isNetworkAvailable?: () => boolean;
  allowMetered?: () => boolean;
  /** Extended diagnostics opt-in (separate from automatic reporting). */
  includeOptional?: () => boolean;
  now?: () => number;
}

export class CrashReportService {
  private readonly deps: CrashServiceDeps;
  private readonly now: () => number;
  private revoked = false;
  private activeAbort: AbortController | null = null;
  private sweepInFlight = false;

  constructor(deps: CrashServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  getConsent(): CrashConsentRecord {
    return this.deps.consent.getConsent();
  }

  /** Explicit user action on consent. Never inferred. */
  applyConsentAction(action: ConsentAction): CrashConsentRecord {
    const record = this.deps.consent.applyAction({
      action,
      appVersion: this.deps.appVersion,
      scope: this.deps.scope,
    });
    if (action === 'revoke' || action === 'deny') {
      this.revoked = true;
      this.abortInFlight();
    }
    if (action === 'enableAutomatic' || action === 'chooseAskEachTime') {
      this.revoked = false;
    }
    return record;
  }

  /** True when the current state permits transmission. */
  private mayUpload(): boolean {
    return !this.revoked && canUpload(this.getConsent().state);
  }

  private abortInFlight(): void {
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = null;
    }
  }

  /**
   * Captures a crash event: sanitize → bound → queue → consent gate.
   * Returns the queued report, or null when capture failed. Never throws.
   */
  async capture(input: RawCaptureInput): Promise<CrashReport | null> {
    const metrics = this.deps.metrics;
    try {
      const raw = this.buildRawReport(input);
      const includeOptional = this.deps.includeOptional?.() ?? false;
      const sanitized = sanitizeCrashReport(raw, { includeOptional });
      if (!sanitized) {
        metrics?.record('redactionFailures');
        metrics?.record('captureFailedCount');
        return null;
      }
      const result = await this.deps.queue.enqueue(sanitized);
      if (result.status !== 'queued') {
        if (result.status === 'dropped-invalid') metrics?.record('redactionFailures');
        metrics?.record('captureFailedCount');
        return null;
      }
      metrics?.record('captureCount');
      const report = result.report;
      // Consent gate: automatic upload, ask the user, or stay silent
      // (denied/managed states are never nagged).
      if (this.mayUpload()) {
        await this.uploadOne(report.reportId);
      } else if (canAsk(this.getConsent().state)) {
        this.deps.onAwaitingDecision?.(report);
      }
      return report;
    } catch {
      metrics?.record('captureFailedCount');
      return null;
    }
  }

  private buildRawReport(input: RawCaptureInput): Record<string, unknown> {
    const context = collectCrashContext({
      appVersion: this.deps.appVersion,
      buildChannel: this.deps.buildChannel,
      releaseId: this.deps.releaseId,
      documentSchemaVersion: this.deps.documentSchemaVersion,
      runtime: this.deps.runtime,
      osFamily: this.deps.osFamily,
      osVersionRange: this.deps.osVersionRange,
      arch: this.deps.arch,
      rendererBackend: this.deps.rendererBackend,
      tauriVersion: this.deps.tauriVersion,
      frontendBundleVersion: this.deps.frontendBundleVersion,
      gitCommit: this.deps.gitCommit,
    });
    return {
      schemaVersion: 1,
      reportId: newReportId(this.now()),
      sessionId: newSessionId(),
      createdAt: this.now(),
      release: context.release,
      runtime: context.runtime,
      crash: {
        type: input.type,
        category: input.category,
        subsystem: input.subsystem,
        message: input.message,
        stack: input.rawStack ?? '',
        rawStack: input.rawStack,
        threadCategory: input.threadCategory,
        reason: input.reason,
      },
      breadcrumbs: input.breadcrumbs ?? [],
      attachments: input.attachments ?? [],
      userComment: input.userComment,
      userContact: input.userContact,
      consentPolicyVersion: this.getConsent().policyVersion,
      recoveryStatus: input.recoveryStatus,
      uploadAttempts: 0,
    };
  }

  /** Uploads every queued report permitted by current consent. */
  async uploadPending(): Promise<void> {
    if (this.sweepInFlight) return;
    this.sweepInFlight = true;
    try {
      if (!this.mayUpload()) return;
      const reports = await this.deps.queue.list();
      for (const report of reports) {
        if (!this.mayUpload()) break;
        await this.uploadOne(report.reportId);
      }
    } finally {
      this.sweepInFlight = false;
    }
  }

  /**
   * Uploads a single report. Fails closed: automatic consent is re-checked
   * synchronously at dispatch; revocation aborts in-flight requests.
   * `forceOneTime` is used by sendOne after an explicit one-time decision —
   * it still refuses to run after revocation.
   */
  async uploadOne(id: string, forceOneTime = false): Promise<CrashUploadResult | null> {
    if (this.revoked) return null;
    if (!forceOneTime && !this.mayUpload()) return null;
    const report = await this.deps.queue.get(id);
    if (!report) return null;
    if (report.uploadAttempts >= LIMITS.maxUploadAttempts) {
      return { ok: false, retryable: false, error: 'retries-exhausted' };
    }
    if (this.deps.isNetworkAvailable && !this.deps.isNetworkAvailable()) {
      return { ok: false, retryable: true, error: 'offline' };
    }
    if (this.deps.allowMetered && !this.deps.allowMetered()) {
      // Do not upload on metered connections when the user disabled this.
      return { ok: false, retryable: true, error: 'metered-connection' };
    }
    const attempts = await this.deps.queue.recordAttempt(id);
    if (attempts > 1) this.deps.metrics?.record('uploadRetryCount');

    const controller = new AbortController();
    this.activeAbort = controller;
    try {
      const payload = toUploadPayload(report);
      const result = await this.deps.uploader.upload(report, { signal: controller.signal });
      if (result.ok) {
        this.deps.metrics?.record('uploadSuccessCount');
        this.deps.metrics?.record('payloadCount');
        this.deps.metrics?.record('totalPayloadBytes', payload.length);
        // Idempotent: the queue drops the report after success; a repeated
        // delivery is de-duplicated server-side by reportId.
        await this.deps.queue.markUploaded(id, this.now());
        return result;
      }
      this.deps.metrics?.record('uploadFailureCount');
      return result;
    } finally {
      if (this.activeAbort === controller) this.activeAbort = null;
    }
  }

  /** One-time send: records the explicit decision, then uploads ONLY this report. */
  async sendOne(id: string): Promise<CrashUploadResult | null> {
    if (this.revoked) return null;
    if (!canUpload(this.getConsent().state)) {
      // Records a deliberate one-time decision — never automatic.
      this.applyConsentAction('sendOneReport');
    }
    return this.uploadOne(id, true);
  }

  /** Revocation: stops all uploads immediately and aborts in-flight work. */
  revoke(): void {
    this.revoked = true;
    this.abortInFlight();
    this.applyConsentAction('revoke');
  }

  async listQueued(): Promise<CrashReport[]> {
    return this.deps.queue.list();
  }

  async deleteQueued(id: string): Promise<void> {
    await this.deps.queue.delete(id);
  }

  async clearQueue(): Promise<void> {
    await this.deps.queue.clear();
  }

  async attachComment(id: string, comment: string): Promise<CrashReport | null> {
    const report = await this.deps.queue.get(id);
    if (!report) return null;
    report.userComment = comment.slice(0, LIMITS.maxCommentLength) || undefined;
    await this.persist(report);
    return report;
  }

  async attachContact(id: string, contact: string): Promise<CrashReport | null> {
    const report = await this.deps.queue.get(id);
    if (!report) return null;
    report.userContact = contact.slice(0, LIMITS.maxContactLength) || undefined;
    await this.persist(report);
    return report;
  }

  async setAttachmentIncluded(
    id: string,
    index: number,
    included: boolean,
  ): Promise<CrashReport | null> {
    const report = await this.deps.queue.get(id);
    if (!report) return null;
    const attachment = report.attachments[index];
    if (!attachment) return null;
    attachment.included = included;
    await this.persist(report);
    return report;
  }

  /** Re-saves a report through the sanitizer so local edits stay canonical. */
  private async persist(report: CrashReport): Promise<void> {
    const sanitized = sanitizeCrashReport(report, {
      includeOptional: this.deps.includeOptional?.() ?? false,
    });
    if (!sanitized) return;
    await this.deps.queue.delete(report.reportId);
    await this.deps.queue.enqueue(sanitized);
  }
}

function newReportId(now: number): string {
  return `r-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newSessionId(): string {
  // Non-persistent: regenerated per app session, used only for dedup.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
