/**
 * Crash-reporting network transport.
 *
 * Uploads happen ONLY through the service's consent gate. The uploader
 * itself is transport-only: it never decides whether to send. The default
 * uploader is a no-op — nothing is ever transmitted unless a build
 * explicitly configures an ingestion endpoint.
 *
 * Properties:
 *  - TLS-only by construction (endpoint must be https in production config).
 *  - Request-size limits are enforced at the queue boundary.
 *  - Idempotent: reportId + schema version headers allow replay protection.
 *  - Metered-connection guard and bounded backoff live in the service.
 */

import { toUploadPayload } from './redact';
import type { CrashReport } from './schema';

export interface CrashUploadResult {
  ok: boolean;
  /** True when the failure is transient (retryable server/network error). */
  retryable: boolean;
  status?: number;
  error?: string;
}

export interface CrashUploadContext {
  /** Abort signal owned by the service; aborted on consent revocation. */
  signal?: AbortSignal;
}

export interface CrashUploader {
  upload(report: CrashReport, ctx?: CrashUploadContext): Promise<CrashUploadResult>;
}

/** The default uploader: no network activity, ever. */
export class NoopCrashUploader implements CrashUploader {
  async upload(_report: CrashReport, _ctx?: CrashUploadContext): Promise<CrashUploadResult> {
    return { ok: false, retryable: false, error: 'no-uploader-configured' };
  }
}

export interface HttpCrashUploaderOptions {
  /** Ingestion endpoint. null (default) disables uploads entirely. */
  endpoint: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpCrashUploader implements CrashUploader {
  private readonly endpoint: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpCrashUploaderOptions) {
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  isConfigured(): boolean {
    return this.endpoint !== null;
  }

  async upload(report: CrashReport, ctx?: CrashUploadContext): Promise<CrashUploadResult> {
    if (!this.endpoint) {
      return { ok: false, retryable: false, error: 'no-endpoint-configured' };
    }
    const payload = toUploadPayload(report);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    ctx?.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-varve-report-id': report.reportId,
          'x-varve-schema-version': String(report.schemaVersion),
        },
        body: payload,
        signal: controller.signal,
        keepalive: false,
      });
      if (response.ok) {
        return { ok: true, retryable: false, status: response.status };
      }
      const retryable = response.status === 429 || response.status >= 500;
      return { ok: false, retryable, status: response.status };
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        ok: false,
        retryable: !aborted,
        error: aborted
          ? 'timeout-or-revoked'
          : error instanceof Error
            ? error.message
            : 'network-error',
      };
    } finally {
      clearTimeout(timer);
      ctx?.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Bounded exponential backoff with jitter. */
export function backoffDelayMs(attempt: number, baseMs = 30_000, maxMs = 3_600_000): number {
  const exponent = Math.min(attempt, 10);
  const bounded = Math.min(baseMs * 2 ** exponent, maxMs);
  const jitter = bounded * 0.3 * Math.random();
  return Math.round(bounded * 0.7 + jitter);
}

/** True when the browser reports a metered/slow connection. */
export function isMeteredConnection(): boolean {
  const nav = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!nav) return false;
  if (nav.saveData === true) return true;
  return nav.effectiveType === 'slow-2g' || nav.effectiveType === '2g';
}
