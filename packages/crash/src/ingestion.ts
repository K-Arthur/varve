/**
 * Ingestion-side validation — the server's second line of defense.
 *
 * Client-side redaction is NOT the only privacy control. This validator is
 * the reference implementation for a self-hosted ingestion endpoint (see
 * docs/privacy/ingestion.md): it enforces request-size limits, schema
 * validation, and canonical-redaction verification, and rejects malformed,
 * oversized, or unredacted payloads. `validateReportForIngestion` is also
 * used by tests to prove that a payload that passes the client boundary is
 * exactly the canonical sanitized form.
 */

import { sanitizeCrashReport, toUploadPayload } from './redact';
import { type CrashReport, isValidCrashReport, LIMITS, validateCrashReport } from './schema';

export const INGESTION_MAX_PAYLOAD_BYTES = LIMITS.maxReportBytes + 4096;

export interface IngestionResult {
  accepted: boolean;
  /** HTTP status code a compliant endpoint should return. */
  status: 200 | 400 | 413 | 422;
  reportId?: string;
  issues: Array<{ code: string; message: string }>;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Validates a raw HTTP body exactly as the ingestion endpoint should:
 *  1. byte-size bound (before parsing),
 *  2. safe JSON parse,
 *  3. schema validation with unknown-field rejection,
 *  4. canonical-redaction verification — the payload must equal its own
 *     sanitized form, proving the client sent nothing that required
 *     scrubbing (and that scrubbing happened before transmission).
 */
export function validateReportForIngestion(rawBody: string): IngestionResult {
  if (typeof rawBody !== 'string' || rawBody.length === 0) {
    return {
      accepted: false,
      status: 400,
      issues: [{ code: 'empty-body', message: 'empty body' }],
    };
  }
  if (rawBody.length > INGESTION_MAX_PAYLOAD_BYTES) {
    return {
      accepted: false,
      status: 413,
      issues: [
        {
          code: 'payload-too-large',
          message: `payload exceeds ${INGESTION_MAX_PAYLOAD_BYTES} bytes`,
        },
      ],
    };
  }
  const parsed = safeParse(rawBody);
  if (parsed === null || typeof parsed !== 'object') {
    return {
      accepted: false,
      status: 400,
      issues: [{ code: 'malformed-json', message: 'malformed JSON' }],
    };
  }
  const schemaIssues = validateCrashReport(parsed);
  if (schemaIssues.length > 0) {
    return {
      accepted: false,
      status: 422,
      issues: schemaIssues.map((issue) => ({
        code: issue.code,
        message: `${issue.path}: ${issue.message}`,
      })),
    };
  }
  const report = parsed as CrashReport;

  // Attachment policy: content never arrives; everything transmitted must be
  // explicitly included by the user.
  if (report.attachments.some((a) => a.content !== undefined)) {
    return {
      accepted: false,
      status: 422,
      issues: [
        { code: 'attachment-content-rejected', message: 'attachment content is not accepted' },
      ],
    };
  }
  if (!report.attachments.every((a) => a.included === true)) {
    return {
      accepted: false,
      status: 422,
      issues: [
        { code: 'unincluded-attachment', message: 'attachments must be explicitly included' },
      ],
    };
  }

  // Canonical-redaction verification: the payload must already be in its
  // final transmitted form. Any difference means redaction did not run
  // (or ran differently) before transmission — reject.
  const canonical = sanitizeCrashReport(parsed, { includeAttachmentContent: false });
  if (!canonical) {
    return {
      accepted: false,
      status: 422,
      issues: [{ code: 'redaction-verification-failed', message: 'payload is not canonical' }],
    };
  }
  if (toUploadPayload(canonical) !== rawBody) {
    return {
      accepted: false,
      status: 422,
      issues: [
        {
          code: 'redaction-verification-failed',
          message: 'payload differs from its sanitized form',
        },
      ],
    };
  }

  return {
    accepted: isValidCrashReport(canonical),
    status: 200,
    reportId: report.reportId,
    issues: [],
  };
}
