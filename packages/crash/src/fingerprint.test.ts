import { describe, expect, it } from 'vitest';
import { computeGroupFingerprint, fnv1a, groupByFingerprint } from './fingerprint';
import type { CrashReport } from './schema';

function baseReport(): CrashReport {
  return {
    schemaVersion: 1,
    reportId: 'r-1',
    sessionId: 's-1',
    createdAt: 1,
    release: {
      appVersion: '0.1.0',
      buildChannel: 'production',
      releaseId: 'rel-1',
      documentSchemaVersion: 3,
    },
    runtime: {
      runtime: 'tauri',
      osFamily: 'linux',
      arch: 'x64',
      memoryPressure: 'medium',
      rendererBackend: 'canvas2d',
    },
    crash: {
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      stack: [
        { module: 'CanvasArea.tsx', function: 'renderSubtree' },
        { module: 'replay.ts', function: 'drawFrame' },
      ],
      threadCategory: 'main',
    },
    breadcrumbs: [],
    attachments: [],
    consentPolicyVersion: 1,
    recoveryStatus: 'not-applicable',
    uploadAttempts: 0,
  };
}

describe('computeGroupFingerprint', () => {
  it('is stable for identical technical crashes', () => {
    const a = computeGroupFingerprint(baseReport());
    const b = computeGroupFingerprint(baseReport());
    expect(a).toBe(b);
  });

  it('does not depend on reportId, timestamps, or messages', () => {
    const a = computeGroupFingerprint(baseReport());
    const bReport = baseReport();
    bReport.reportId = 'r-other';
    bReport.createdAt = 999;
    bReport.sessionId = 's-x';
    const b = computeGroupFingerprint(bReport);
    expect(a).toBe(b);
  });

  it('differs across crash categories and subsystems', () => {
    const a = baseReport();
    const b = baseReport();
    b.crash.category = 'wasm-trap';
    expect(computeGroupFingerprint(a)).not.toBe(computeGroupFingerprint(b));
  });

  it('differs across releases', () => {
    const a = baseReport();
    const b = baseReport();
    b.release.releaseId = 'rel-2';
    expect(computeGroupFingerprint(a)).not.toBe(computeGroupFingerprint(b));
  });

  it('ignores user-identifying fields entirely (never part of the material)', () => {
    const a = baseReport();
    const b = baseReport();
    b.crash.message = 'alice@example.com /home/alice/logo-final.strata';
    expect(computeGroupFingerprint(a)).toBe(computeGroupFingerprint(b));
  });

  it('is bounded in length', () => {
    const report = baseReport();
    report.crash.stack = Array.from({ length: 40 }, (_, i) => ({
      module: `module-${i}-${'x'.repeat(200)}`,
    }));
    expect(computeGroupFingerprint(report).length).toBeLessThanOrEqual(80);
  });
});

describe('groupByFingerprint', () => {
  it('groups duplicates', () => {
    const a = baseReport();
    const b = baseReport();
    b.reportId = 'r-2';
    const c = baseReport();
    c.crash.category = 'other';
    const groups = groupByFingerprint([a, b, c]);
    const counts = [...groups.values()].map((g) => g.length).sort();
    expect(counts).toEqual([1, 2]);
  });

  it('is deterministic', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
  });
});
