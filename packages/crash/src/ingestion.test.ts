import { describe, expect, it } from 'vitest';
import { validateReportForIngestion } from './ingestion';
import { sanitizeCrashReport, toUploadPayload } from './redact';
import { buildAdversarialRawReport } from './redactFixtures';
import { LIMITS } from './schema';

function canonicalPayload(): string {
  const report = sanitizeCrashReport(buildAdversarialRawReport())!;
  return toUploadPayload(report);
}

describe('validateReportForIngestion', () => {
  it('accepts a canonical payload', () => {
    const result = validateReportForIngestion(canonicalPayload());
    expect(result.accepted).toBe(true);
    expect(result.status).toBe(200);
    expect(result.reportId).toBeTruthy();
  });

  it('rejects empty and malformed bodies', () => {
    expect(validateReportForIngestion('').accepted).toBe(false);
    expect(validateReportForIngestion('{not json').accepted).toBe(false);
    expect(validateReportForIngestion('null').accepted).toBe(false);
    expect(validateReportForIngestion('[1,2,3]').accepted).toBe(false);
  });

  it('rejects oversized payloads before parsing', () => {
    const huge = `{"pad":"${'x'.repeat(LIMITS.maxReportBytes + 6000)}"}`;
    const result = validateReportForIngestion(huge);
    expect(result.accepted).toBe(false);
    expect(result.status).toBe(413);
  });

  it('rejects payloads carrying unknown fields', () => {
    const raw = JSON.parse(canonicalPayload()) as Record<string, unknown>;
    (raw.crash as Record<string, unknown>).userName = 'alice';
    const result = validateReportForIngestion(JSON.stringify(raw));
    expect(result.accepted).toBe(false);
    expect(result.status).toBe(422);
  });

  it('rejects payloads that were not redacted before transmission', () => {
    // A schema-valid payload whose message still contains a full path: the
    // sanitizer would change it, so the boundary rejects it — client-side
    // redaction is not the only control.
    const raw = JSON.parse(canonicalPayload()) as Record<string, unknown>;
    (raw.crash as Record<string, unknown>).message = 'failed at /home/alice/Documents/logo.strata';
    const result = validateReportForIngestion(JSON.stringify(raw));
    expect(result.accepted).toBe(false);
    expect(result.issues[0]?.code).toBe('redaction-verification-failed');
  });

  it('rejects attachment content at the endpoint', () => {
    const report = sanitizeCrashReport(buildAdversarialRawReport())!;
    report.attachments[0]!.included = true;
    report.attachments[0]!.content = 'secret-bytes';
    const payload = JSON.stringify(report);
    const result = validateReportForIngestion(payload);
    expect(result.accepted).toBe(false);
    expect(result.issues[0]?.code).toBe('attachment-content-rejected');
  });

  it('rejects unincluded attachments', () => {
    const raw = JSON.parse(canonicalPayload()) as Record<string, unknown>;
    raw.attachments = [{ kind: 'log', name: 'varve-log.txt', sizeBytes: 1, included: false }];
    const result = validateReportForIngestion(JSON.stringify(raw));
    expect(result.accepted).toBe(false);
    expect(result.issues[0]?.code).toBe('unincluded-attachment');
  });

  it('rejects missing required fields', () => {
    const raw = JSON.parse(canonicalPayload()) as Record<string, unknown>;
    delete (raw.release as Record<string, unknown>).appVersion;
    const result = validateReportForIngestion(JSON.stringify(raw));
    expect(result.accepted).toBe(false);
    expect(result.status).toBe(422);
  });
});
