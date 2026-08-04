import { describe, expect, it } from 'vitest';
import { CrashReportQueue, MemoryCrashReportStorage } from './queue';
import { type CrashReport, LIMITS } from './schema';

function makeReport(overrides: Partial<CrashReport> = {}): CrashReport {
  return {
    schemaVersion: 1,
    reportId: `r-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: 's-1',
    createdAt: Date.now(),
    release: {
      appVersion: '0.1.0',
      buildChannel: 'dev',
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
      stack: [],
      threadCategory: 'main',
    },
    breadcrumbs: [],
    attachments: [],
    consentPolicyVersion: 1,
    recoveryStatus: 'not-applicable',
    uploadAttempts: 0,
    ...overrides,
  };
}

describe('CrashReportQueue', () => {
  it('enqueues valid reports', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage());
    const result = await q.enqueue(makeReport());
    expect(result.status).toBe('queued');
    expect(await q.list()).toHaveLength(1);
  });

  it('refuses invalid reports at the boundary', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage());
    const invalid = makeReport();
    invalid.release.appVersion = '';
    const result = await q.enqueue(invalid);
    expect(result.status).toBe('dropped-invalid');
  });

  it('caps the number of queued reports by evicting the oldest', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage(), () => 1000);
    for (let i = 0; i < LIMITS.maxQueuedReports + 5; i++) {
      await q.enqueue(makeReport({ reportId: `r-${i}`, createdAt: 1000 + i }));
    }
    const reports = await q.list();
    expect(reports.length).toBeLessThanOrEqual(LIMITS.maxQueuedReports);
    // Newest first: the evicted ones are the oldest.
    expect(reports[0]!.reportId).toBe(`r-${LIMITS.maxQueuedReports + 4}`);
  });

  it('caps total queue bytes by evicting the oldest', async () => {
    const storage = new MemoryCrashReportStorage();
    const q = new CrashReportQueue(storage, () => 1000);
    // ~255 KB per report (attachment content), under the 256 KB report cap.
    const big = (id: string, createdAt: number) =>
      makeReport({
        reportId: id,
        createdAt,
        attachments: [
          {
            kind: 'log',
            name: 'varve-log.txt',
            sizeBytes: LIMITS.maxReportBytes - 6000,
            content: 'x'.repeat(LIMITS.maxReportBytes - 6000),
            included: false,
          },
        ],
      });
    for (let i = 0; i < 120; i++) {
      const result = await q.enqueue(big(`r-${i}`, 1000 + i));
      expect(result.status, `enqueue ${i}`).toBe('queued');
    }
    const reports = await q.list();
    const totalBytes = await storage.totalBytes();
    expect(totalBytes ?? 0).toBeLessThanOrEqual(LIMITS.maxQueueBytes);
    expect(reports.length).toBeLessThan(120);
    // The oldest reports were evicted first.
    expect(reports.some((r) => r.reportId === 'r-0')).toBe(false);
  });

  it('drops a single report that exceeds the size limit', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage());
    const huge = makeReport({
      userComment: 'z'.repeat(LIMITS.maxReportBytes + 100),
    });
    const result = await q.enqueue(huge);
    expect(result.status).toBe('dropped-invalid');
  });

  it('expires reports after the retention period', async () => {
    const now = 1000;
    const q = new CrashReportQueue(new MemoryCrashReportStorage(), () => now);
    await q.enqueue(
      makeReport({ reportId: 'r-old', createdAt: now - LIMITS.reportExpiryMs - 5000 }),
    );
    await q.enqueue(makeReport({ reportId: 'r-new', createdAt: now - 1000 }));
    await q.sweepExpired();
    const reports = await q.list();
    expect(reports.map((r) => r.reportId)).toEqual(['r-new']);
  });

  it('isolates corrupt entries without blocking startup', async () => {
    const storage = new MemoryCrashReportStorage();
    await storage.save('r-good', JSON.stringify(makeReport({ reportId: 'r-good' })));
    await storage.save('r-corrupt', '{not json');
    await storage.save('r-bad-schema', JSON.stringify({ whatever: true }));
    const q = new CrashReportQueue(storage);
    const reports = await q.list();
    expect(reports.map((r) => r.reportId)).toEqual(['r-good']);
  });

  it('markUploaded is idempotent and does not retain the report', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage());
    const report = makeReport();
    await q.enqueue(report);
    await q.markUploaded(report.reportId, 42);
    await q.markUploaded(report.reportId, 43);
    expect(await q.list()).toHaveLength(0);
  });

  it('tracks upload attempts', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage());
    const report = makeReport();
    await q.enqueue(report);
    expect(await q.recordAttempt(report.reportId)).toBe(1);
    expect(await q.recordAttempt(report.reportId)).toBe(2);
    const [queued] = await q.list();
    expect(queued!.uploadAttempts).toBe(2);
  });

  it('survives a storage restart (memory store persists across instances)', async () => {
    const storage = new MemoryCrashReportStorage();
    const q1 = new CrashReportQueue(storage);
    const report = makeReport();
    await q1.enqueue(report);
    const q2 = new CrashReportQueue(storage);
    expect(await q2.list()).toHaveLength(1);
  });

  it('delete removes a single report', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage());
    const a = await q.enqueue(makeReport({ reportId: 'r-a' }));
    await q.enqueue(makeReport({ reportId: 'r-b' }));
    await q.delete(a.status === 'queued' ? a.report.reportId : 'r-a');
    expect((await q.list()).map((r) => r.reportId)).toEqual(['r-b']);
  });

  it('clear removes everything', async () => {
    const q = new CrashReportQueue(new MemoryCrashReportStorage());
    await q.enqueue(makeReport());
    await q.enqueue(makeReport());
    await q.clear();
    expect(await q.list()).toHaveLength(0);
  });
});
