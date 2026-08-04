import { describe, expect, it, vi } from 'vitest';
import { CrashConsentProvider, MemoryCrashConsentStorage, unknownConsent } from './consent';
import { MemoryCrashLoopStore, recordStartupFailure } from './crashLoop';
import { LocalCrashMetrics } from './metrics';
import { CrashReportQueue, MemoryCrashReportStorage } from './queue';
import { FIXTURE_DOCUMENT_NAME, FIXTURE_USERNAME, SECRET_FIXTURES } from './redactFixtures';
import { type CrashReport, LIMITS } from './schema';
import { CrashReportService, type RawCaptureInput } from './service';
import { type CrashUploader, type CrashUploadResult, NoopCrashUploader } from './uploader';

/** Recording uploader: asserts exactly when and what the service transmits. */
class RecordingUploader implements CrashUploader {
  uploaded: Array<{ report: CrashReport; payload: string }> = [];
  failTimes = 0;
  private failCount = 0;

  setFailNext(times: number): void {
    this.failTimes = times;
    this.failCount = 0;
  }

  async upload(report: CrashReport, _ctx?: { signal?: AbortSignal }): Promise<CrashUploadResult> {
    if (this.failCount < this.failTimes) {
      this.failCount++;
      return { ok: false, retryable: true, error: 'simulated-failure' };
    }
    this.uploaded.push({ report, payload: JSON.stringify(report) });
    return { ok: true, retryable: false, status: 200 };
  }
}

function makeRawInput(overrides: Partial<RawCaptureInput> = {}): RawCaptureInput {
  return {
    type: 'error',
    category: 'render-loop',
    subsystem: 'canvas',
    message: `render failed: ${SECRET_FIXTURES.homePath}`,
    rawStack: `Error: boom\n    at fn (${SECRET_FIXTURES.homePath}:1:1)`,
    threadCategory: 'main',
    recoveryStatus: 'not-applicable',
    ...overrides,
  };
}

interface Harness {
  service: CrashReportService;
  uploader: RecordingUploader;
  consent: CrashConsentProvider;
  queue: CrashReportQueue;
  metrics: LocalCrashMetrics;
  awaiting: CrashReport[];
}

function makeHarness(
  consentState: 'unknown' | 'denied' | 'askEachTime' | 'automaticAllowed',
): Harness {
  const storage = new MemoryCrashConsentStorage();
  if (consentState !== 'unknown') {
    storage.save({ ...unknownConsent(), state: consentState, decidedAt: 1, appVersion: '0.1.0' });
  }
  const consent = new CrashConsentProvider(storage);
  const queue = new CrashReportQueue(new MemoryCrashReportStorage());
  const uploader = new RecordingUploader();
  const metrics = new LocalCrashMetrics({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  const awaiting: CrashReport[] = [];
  const service = new CrashReportService({
    consent,
    queue,
    uploader,
    metrics,
    appVersion: '0.1.0',
    buildChannel: 'dev',
    releaseId: 'rel-test',
    documentSchemaVersion: 3,
    runtime: 'tauri',
    scope: 'both',
    onAwaitingDecision: (report) => awaiting.push(report),
  });
  return { service, uploader, consent, queue, metrics, awaiting };
}

describe('no crash-report traffic without consent', () => {
  it('unknown consent: capture queues locally but never uploads', async () => {
    const h = makeHarness('unknown');
    const report = await h.service.capture(makeRawInput());
    expect(report).not.toBeNull();
    expect(h.uploader.uploaded.length).toBe(0);
    expect(await h.queue.list()).toHaveLength(1);
    expect(h.awaiting).toHaveLength(1);
  });

  it('denied consent: capture queues locally but never uploads and never asks', async () => {
    const h = makeHarness('denied');
    const report = await h.service.capture(makeRawInput());
    expect(report).not.toBeNull();
    expect(h.uploader.uploaded.length).toBe(0);
    expect(h.awaiting).toHaveLength(0);
  });

  it('askEachTime: capture queues and asks but never uploads', async () => {
    const h = makeHarness('askEachTime');
    await h.service.capture(makeRawInput());
    expect(h.uploader.uploaded.length).toBe(0);
    expect(h.awaiting).toHaveLength(1);
  });

  it('uploadPending does nothing without automatic consent', async () => {
    for (const state of ['unknown', 'denied', 'askEachTime'] as const) {
      const h = makeHarness(state);
      await h.service.capture(makeRawInput());
      await h.service.uploadPending();
      expect(h.uploader.uploaded.length, `state ${state}`).toBe(0);
    }
  });

  it('noop uploader is the default — no endpoint, no fetch', async () => {
    const h = makeHarness('automaticAllowed');
    const spy = vi.spyOn(globalThis, 'fetch');
    const noop = new NoopCrashUploader();
    const service = new CrashReportService({
      consent: h.consent,
      queue: h.queue,
      uploader: noop,
      appVersion: '0.1.0',
      buildChannel: 'dev',
      releaseId: 'rel',
      documentSchemaVersion: 1,
      runtime: 'browser',
      scope: 'both',
    });
    const report = await service.capture(makeRawInput());
    expect(report).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('consent-gated upload', () => {
  it('automaticAllowed uploads immediately on capture', async () => {
    const h = makeHarness('automaticAllowed');
    await h.service.capture(makeRawInput());
    expect(h.uploader.uploaded.length).toBe(1);
    // Successful uploads leave the queue.
    expect(await h.queue.list()).toHaveLength(0);
  });

  it('one-time send uploads only that report and never enables automatic', async () => {
    const h = makeHarness('unknown');
    const first = await h.service.capture(makeRawInput());
    const second = await h.service.capture(makeRawInput({ message: 'second crash' }));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const result = await h.service.sendOne(first!.reportId);
    expect(result?.ok).toBe(true);
    expect(h.uploader.uploaded.map((u) => u.report.reportId)).toEqual([first!.reportId]);
    // Consent state changed to askEachTime — not automatic.
    expect(h.service.getConsent().state).toBe('askEachTime');
    // A new capture still asks instead of uploading.
    await h.service.capture(makeRawInput({ message: 'third crash' }));
    expect(h.uploader.uploaded.length).toBe(1);
    expect(h.awaiting.length).toBeGreaterThan(0);
  });

  it('sendOne after deny records a one-time decision', async () => {
    const h = makeHarness('denied');
    const report = await h.service.capture(makeRawInput());
    const result = await h.service.sendOne(report!.reportId);
    expect(result?.ok).toBe(true);
    expect(h.service.getConsent().state).toBe('askEachTime');
  });

  it('revocation stops pending uploads immediately', async () => {
    const h = makeHarness('automaticAllowed');
    const first = await h.service.capture(makeRawInput());
    expect(first).not.toBeNull();
    expect(h.uploader.uploaded.length).toBe(1);
    // Consent changes to askEachTime, then a capture queues without upload.
    h.service.applyConsentAction('chooseAskEachTime');
    await h.service.capture(makeRawInput({ message: 'queued while ask' }));
    expect(h.uploader.uploaded.length).toBe(1);
    h.service.revoke();
    expect(h.service.getConsent().state).toBe('denied');
    await h.service.uploadPending();
    expect(h.uploader.uploaded.length).toBe(1);
    // Queued report remains inspectable/deletable by the user.
    expect(await h.queue.list()).toHaveLength(1);
  });

  it('revocation aborts in-flight uploads', async () => {
    const h = makeHarness('askEachTime');
    let resolveUpload: (r: CrashUploadResult) => void = () => undefined;
    let gotSignal: AbortSignal | undefined;
    const hanging: CrashUploader = {
      upload: (_report, ctx) =>
        new Promise<CrashUploadResult>((resolve) => {
          gotSignal = ctx?.signal;
          resolveUpload = resolve;
        }),
    };
    const service = new CrashReportService({
      consent: h.consent,
      queue: h.queue,
      uploader: hanging,
      appVersion: '0.1.0',
      buildChannel: 'dev',
      releaseId: 'rel',
      documentSchemaVersion: 1,
      runtime: 'tauri',
      scope: 'both',
    });
    // Capture under askEachTime: queued, not uploaded.
    const report = await service.capture(makeRawInput());
    service.applyConsentAction('enableAutomatic');
    const pending = service.uploadOne(report!.reportId);
    // Flush microtasks so upload() is actually dispatched before revoking.
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.revoke();
    expect(gotSignal?.aborted).toBe(true);
    resolveUpload({ ok: false, retryable: true, error: 'late' });
    const result = await pending;
    expect(result?.ok).toBe(false);
    // The report was never marked uploaded; the user can review/delete it.
    expect(await service.listQueued()).toHaveLength(1);
  });

  it('upload failures stay queued and attempts are bounded', async () => {
    const h = makeHarness('automaticAllowed');
    h.uploader.setFailNext(99);
    const report = await h.service.capture(makeRawInput());
    expect(report).not.toBeNull();
    expect(await h.queue.list()).toHaveLength(1);
    for (let i = 0; i < LIMITS.maxUploadAttempts + 2; i++) {
      await h.service.uploadPending();
    }
    const queued = await h.queue.list();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.uploadAttempts).toBe(LIMITS.maxUploadAttempts);
    const exhausted = await h.service.uploadOne(queued[0]!.reportId);
    expect(exhausted).toMatchObject({ retryable: false, error: 'retries-exhausted' });
  });
});

describe('capture sanitization before queueing', () => {
  it('prohibited fixture values never reach the uploader', async () => {
    const h = makeHarness('automaticAllowed');
    const raw = makeRawInput({
      message: Object.values(SECRET_FIXTURES).join(' | '),
      rawStack: Object.values(SECRET_FIXTURES).join('\n'),
    });
    await h.service.capture(raw);
    expect(h.uploader.uploaded).toHaveLength(1);
    const serialized = h.uploader.uploaded[0]!.payload;
    for (const needle of [
      SECRET_FIXTURES.homePath,
      SECRET_FIXTURES.email,
      SECRET_FIXTURES.bearer,
      SECRET_FIXTURES.awsKey,
      FIXTURE_USERNAME,
      FIXTURE_DOCUMENT_NAME,
    ]) {
      expect(serialized).not.toContain(needle);
    }
  });

  it('queued reports are already redacted (redaction runs before storage)', async () => {
    const h = makeHarness('unknown');
    await h.service.capture(makeRawInput());
    const [queued] = await h.queue.list();
    expect(queued).toBeDefined();
    expect(JSON.stringify(queued)).not.toContain(FIXTURE_USERNAME);
    expect(JSON.stringify(queued)).not.toContain(SECRET_FIXTURES.email);
  });

  it('extended diagnostics are not included without a separate opt-in', async () => {
    let includeOptional = false;
    const h = makeHarness('unknown');
    const service = new CrashReportService({
      consent: h.consent,
      queue: h.queue,
      uploader: h.uploader,
      appVersion: '0.1.0',
      buildChannel: 'dev',
      releaseId: 'rel',
      documentSchemaVersion: 1,
      runtime: 'tauri',
      scope: 'both',
      includeOptional: () => includeOptional,
    });
    const report = await service.capture(makeRawInput({ reason: 'gpu lost' }));
    expect(report!.crash.rawStack).toBeUndefined();
    expect(report!.crash.reason).toBeUndefined();
    includeOptional = true;
    const report2 = await service.capture(makeRawInput({ reason: 'gpu lost' }));
    expect(report2!.crash.rawStack).toBeDefined();
    expect(report2!.crash.reason).toBe('gpu lost');
  });
});

describe('offline and metered behavior', () => {
  it('offline uploads are retried later, never dropped', async () => {
    let online = false;
    const h = makeHarness('automaticAllowed');
    const service = new CrashReportService({
      consent: h.consent,
      queue: h.queue,
      uploader: h.uploader,
      appVersion: '0.1.0',
      buildChannel: 'dev',
      releaseId: 'rel',
      documentSchemaVersion: 1,
      runtime: 'tauri',
      scope: 'both',
      isNetworkAvailable: () => online,
    });
    await service.capture(makeRawInput());
    expect(h.uploader.uploaded).toHaveLength(0);
    expect(await h.queue.list()).toHaveLength(1);
    online = true;
    await service.uploadPending();
    expect(h.uploader.uploaded).toHaveLength(1);
  });

  it('metered connections are respected', async () => {
    let allowMetered = false;
    const h = makeHarness('automaticAllowed');
    const service = new CrashReportService({
      consent: h.consent,
      queue: h.queue,
      uploader: h.uploader,
      appVersion: '0.1.0',
      buildChannel: 'dev',
      releaseId: 'rel',
      documentSchemaVersion: 1,
      runtime: 'tauri',
      scope: 'both',
      allowMetered: () => allowMetered,
    });
    await service.capture(makeRawInput());
    expect(h.uploader.uploaded).toHaveLength(0);
    allowMetered = true;
    await service.uploadPending();
    expect(h.uploader.uploaded).toHaveLength(1);
  });
});

describe('reporter health metrics', () => {
  it('records capture and upload metrics locally', async () => {
    const h = makeHarness('automaticAllowed');
    await h.service.capture(makeRawInput());
    expect(h.metrics.snapshot().captureCount).toBe(1);
    expect(h.metrics.snapshot().uploadSuccessCount).toBe(1);
    expect(h.metrics.snapshot().totalPayloadBytes).toBeGreaterThan(0);
  });
});

describe('crash loop and safe mode integration', () => {
  it('crash-loop detection requires repeated failures within a window', () => {
    const store = new MemoryCrashLoopStore();
    expect(recordStartupFailure(store, 1000)).toBe(1);
    expect(recordStartupFailure(store, 2000)).toBe(2);
    expect(recordStartupFailure(store, 3000)).toBe(3);
    expect(store.load().failures).toHaveLength(3);
  });
});
