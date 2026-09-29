import { afterEach, describe, expect, it, vi } from 'vitest';
import { InferenceAdmission } from '../admission';
import type { WorkerInferRequest, WorkerReleaseRequest } from '../inferenceWorker';
import { InferenceWorkerHost } from '../inferenceWorkerHost';
import { workerSessionKey } from '../sessionKeys';

/** The host must route readiness, session-residency, errors, and results together. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}

function makeHost() {
  // The host constructs its own worker, so the stub records the instance it
  // builds rather than handing back a prepared one. It must be a class: an
  // arrow function cannot be used with `new`.
  let created: FakeWorker | null = null;
  class StubWorker extends FakeWorker {
    constructor() {
      super();
      created = this;
    }
  }
  const admission = new InferenceAdmission({ maxConcurrent: 1 });
  vi.stubGlobal('Worker', StubWorker as unknown as typeof Worker);
  const host = new InferenceWorkerHost('about:blank', admission);
  return {
    host,
    admission,
    get worker(): FakeWorker {
      if (!created) throw new Error('host never constructed a worker');
      return created;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** `infer` posts synchronously inside the promise executor. */
function requestIdOf(worker: FakeWorker): string {
  const first = worker.posted[0] as { requestId?: string } | undefined;
  if (!first?.requestId) throw new Error('worker received no message');
  return first.requestId;
}

/** Most protocol tests isolate host lifetimes from model-memory estimates. */
function workerRequest(
  modelType: string,
  modelPath: string,
  modelId = modelType,
  sessionPeakBytes = 0,
) {
  return { type: 'infer', modelType, modelPath, modelId, sessionPeakBytes } as never;
}

function sessionKeyFrom(worker: FakeWorker): string {
  const request = worker.posted[0] as WorkerInferRequest;
  return workerSessionKey(request.modelType, request.modelPath, {
    ...request.sessionIdentity,
    modelId: request.modelId,
    externalDataPath: request.externalData?.path,
  });
}

function emitSessionReady(worker: FakeWorker, requestId: string, estimateBytes: number): string {
  const request = worker.posted[0] as WorkerInferRequest;
  const sessionKey = sessionKeyFrom(worker);
  worker.emit({
    type: 'session-ready',
    requestId,
    sessionKey,
    modelType: request.modelType,
    modelPath: request.modelPath,
    estimateBytes,
    evictedKeys: [],
  });
  return sessionKey;
}

describe('InferenceWorkerHost message handling', () => {
  it('surfaces a worker error instead of waiting out the timeout', async () => {
    const h = makeHost();
    const pending = h.host.infer(workerRequest('scunet', '/m.onnx'), { timeoutMs: 5000 });
    const requestId = requestIdOf(h.worker);
    // An error arriving before any `ready` must still reach the caller.
    h.worker.emit({ type: 'error', requestId, message: 'Model exceeds safe WASM memory limit.' });
    await expect(pending).rejects.toThrow(/exceeds safe WASM/);
    vi.unstubAllGlobals();
  });

  it('resolves a result that arrives without a preceding ready message', async () => {
    const h = makeHost();
    const pending = h.host.infer(workerRequest('scunet', '/m.onnx'), { timeoutMs: 5000 });
    const requestId = requestIdOf(h.worker);
    h.worker.emit({ type: 'result', requestId, outputs: { out: 42 } });
    await expect(pending).resolves.toMatchObject({ outputs: { out: 42 } });
    vi.unstubAllGlobals();
  });

  it('detaches a cancelled request without terminating unrelated worker work', async () => {
    const h = makeHost();
    const controller = new AbortController();
    const pending = h.host.infer(workerRequest('scunet', '/m.onnx'), {
      timeoutMs: 5000,
      signal: controller.signal,
      reservationBytes: 5_000_000,
    });
    const requestId = requestIdOf(h.worker);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'inference_cancelled' });
    expect(h.worker.terminated).toBe(false);
    expect(h.host.pendingCount).toBe(1);
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 1,
      pending: 0,
      reservedBytes: 5_000_000,
    });
    expect(h.host.recycleWorkerIfIdle()).toBe(false);

    // A replacement stays queued until the old graph returns its terminal
    // response. Its result is discarded, then the single-worker lease moves.
    const replacement = h.host.infer(workerRequest('scunet', '/next.onnx'), {
      timeoutMs: 5000,
      reservationBytes: 3_000_000,
    });
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 1,
      pending: 1,
      reservedBytes: 5_000_000,
    });
    expect(h.worker.posted).toHaveLength(1);

    h.worker.emit({ type: 'result', requestId, outputs: { stale: true } });
    await vi.waitFor(() => expect(h.worker.posted).toHaveLength(2));
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 1,
      pending: 0,
      reservedBytes: 3_000_000,
    });
    const replacementId = (h.worker.posted[1] as { requestId: string }).requestId;
    h.worker.emit({ type: 'result', requestId: replacementId, outputs: { fresh: true } });
    await expect(replacement).resolves.toMatchObject({ outputs: { fresh: true } });
    expect(h.host.pendingCount).toBe(0);
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 0,
      pending: 0,
      reservedBytes: 0,
    });
  });

  it('keeps a cancelled execution reserved until its deadline terminates the worker', async () => {
    vi.useFakeTimers();
    const h = makeHost();
    const controller = new AbortController();
    const pending = h.host.infer(workerRequest('scunet', '/m.onnx'), {
      timeoutMs: 10,
      signal: controller.signal,
      reservationBytes: 7_000_000,
    });
    const owner = h.worker;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'inference_cancelled' });
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 1,
      reservedBytes: 7_000_000,
    });

    await vi.advanceTimersByTimeAsync(11);
    expect(owner.terminated).toBe(true);
    expect(h.host.pendingCount).toBe(0);
    expect(h.admission.getSnapshot()).toMatchObject({ active: 0, reservedBytes: 0 });
  });

  it('terminates the worker when late session cleanup cannot be confirmed', async () => {
    const h = makeHost();
    const pending = h.host.infer(workerRequest('scunet', '/m.onnx'), {
      timeoutMs: 5000,
      reservationBytes: 9_000_000,
    });
    const owner = h.worker;
    owner.emit({
      type: 'fatal',
      requestId: requestIdOf(owner),
      message: 'late session release failed',
    });

    await expect(pending).rejects.toMatchObject({ code: 'worker_crash' });
    expect(owner.terminated).toBe(true);
    expect(h.host.pendingCount).toBe(0);
    expect(h.admission.getSnapshot()).toMatchObject({ active: 0, reservedBytes: 0 });
  });

  it('keeps admission until dispose has terminated the cancelled request owner', async () => {
    const h = makeHost();
    const controller = new AbortController();
    const pending = h.host.infer(workerRequest('scunet', '/m.onnx'), {
      timeoutMs: 5000,
      signal: controller.signal,
      reservationBytes: 4_000_000,
    });
    const owner = h.worker;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'inference_cancelled' });
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 1,
      reservedBytes: 4_000_000,
    });

    h.host.dispose();
    expect(owner.terminated).toBe(true);
    expect(h.host.pendingCount).toBe(0);
    expect(h.admission.getSnapshot()).toMatchObject({ active: 0, reservedBytes: 0 });
  });

  it('terminates the worker on timeout so a retry gets a clean worker', async () => {
    vi.useFakeTimers();
    const h = makeHost();
    const pending = h.host.infer(workerRequest('detr', '/m.onnx'), { timeoutMs: 10 });
    const rejection = expect(pending).rejects.toThrow(/timed out/i);
    const firstWorker = h.worker;
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    expect(firstWorker.terminated).toBe(true);

    const retry = h.host.infer(workerRequest('detr', '/m.onnx'), { timeoutMs: 100 });
    const secondWorker = h.worker;
    expect(secondWorker).not.toBe(firstWorker);
    secondWorker.emit({
      type: 'result',
      requestId: requestIdOf(secondWorker),
      outputs: { retried: true },
    });
    await expect(retry).resolves.toMatchObject({ outputs: { retried: true } });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('correlates a release request and records honest residency evidence', async () => {
    const h = makeHost();
    const pending = h.host.releaseModel('grounding-dino', '/models/gd.onnx');
    const request = h.worker.posted[0] as { type: string; requestId: string; keys: string[] };
    expect(request.type).toBe('release');
    expect(request.keys).toEqual(['grounding-dino:/models/gd.onnx']);

    const report = {
      type: 'released' as const,
      requestId: request.requestId,
      released: ['grounding-dino:/models/gd.onnx'],
      failed: [],
      inUse: [],
      possiblyResidentBytes: 0,
      remaining: 0,
      snapshot: {
        cached: 0,
        inUse: 0,
        unresolvedKeys: [],
        unresolvedBytes: 0,
        retainedCapacityBytes: 0,
        highWaterBytes: 2_600_000_000,
      },
    };
    h.worker.emit(report);
    await expect(pending).resolves.toMatchObject({ released: request.keys });
    const diagnostics = h.host.getResidencyDiagnostics();
    expect(diagnostics.releasedSessions).toBe(1);
    expect(diagnostics.failedReleases).toBe(0);
    // High-water bytes are diagnostic; unresolved bytes stay zero on success.
    expect(diagnostics.unresolvedBytes).toBe(0);

    // A failed release keeps the bytes accounted for the next admission.
    const failing = h.host.releaseModels(['sam2-encoder:/big.onnx']);
    const failingRequest = h.worker.posted[1] as { requestId: string };
    h.worker.emit({
      type: 'released',
      requestId: failingRequest.requestId,
      released: [],
      failed: [{ key: 'sam2-encoder:/big.onnx', message: 'device lost' }],
      inUse: [],
      possiblyResidentBytes: 154_902_201,
      remaining: 1,
      snapshot: {
        cached: 1,
        inUse: 0,
        unresolvedKeys: ['sam2-encoder:/big.onnx'],
        unresolvedBytes: 154_902_201,
        retainedCapacityBytes: 154_902_201,
        highWaterBytes: 154_902_201,
      },
    });
    await failing;
    const afterFailure = h.host.getResidencyDiagnostics();
    expect(afterFailure.failedReleases).toBe(1);
    expect(afterFailure.unresolvedBytes).toBe(154_902_201);
    vi.unstubAllGlobals();
  });

  it('recycles only an idle worker and clears unresolved residency on recycle', async () => {
    const h = makeHost();
    const pendingInfer = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/m.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 5000 },
    );
    expect(h.host.recycleWorkerIfIdle()).toBe(false);

    const firstWorker = h.worker;
    h.worker.emit({
      type: 'result',
      requestId: requestIdOf(firstWorker),
      outputs: { done: true },
    });
    await pendingInfer;

    const failing = h.host.releaseModels();
    const releaseRequest = firstWorker.posted.at(-1) as { requestId: string };
    firstWorker.emit({
      type: 'released',
      requestId: releaseRequest.requestId,
      released: [],
      failed: [{ key: 'x', message: 'stuck' }],
      inUse: [],
      possiblyResidentBytes: 10,
      remaining: 1,
      snapshot: {
        cached: 1,
        inUse: 0,
        unresolvedKeys: ['x'],
        unresolvedBytes: 10,
        retainedCapacityBytes: 10,
        highWaterBytes: 10,
      },
    });
    await failing;
    expect(h.host.getResidencyDiagnostics().unresolvedBytes).toBe(10);

    expect(h.host.recycleWorkerIfIdle()).toBe(true);
    expect(firstWorker.terminated).toBe(true);
    expect(h.host.getResidencyDiagnostics().unresolvedBytes).toBe(0);
    vi.unstubAllGlobals();
  });

  it('transfers a created model estimate to resident admission and releases it only on confirmation', async () => {
    const h = makeHost();
    const pending = h.host.infer(
      workerRequest('depth', '/models/depth.onnx', 'depth-anything-v2-small', 100_000_000),
      { reservationBytes: 20_000_000 },
    );
    const requestId = requestIdOf(h.worker);
    expect(h.admission.getSnapshot()).toMatchObject({
      reservedBytes: 120_000_000,
      residentBytes: 0,
    });

    const sessionKey = emitSessionReady(h.worker, requestId, 100_000_000);
    expect(h.admission.getSnapshot()).toMatchObject({
      activeBytes: 20_000_000,
      residentBytes: 100_000_000,
      reservedBytes: 120_000_000,
    });
    h.worker.emit({ type: 'result', requestId, outputs: { depth: true } });
    await expect(pending).resolves.toMatchObject({ outputs: { depth: true } });

    const release = h.host.releaseModel('depth', '/models/depth.onnx');
    const releaseMessage = h.worker.posted[1] as WorkerReleaseRequest;
    expect(releaseMessage.keys).toEqual([sessionKey]);
    h.worker.emit({
      type: 'released',
      requestId: releaseMessage.requestId,
      released: [sessionKey],
      failed: [],
      inUse: [],
      possiblyResidentBytes: 0,
      remaining: 0,
      snapshot: {
        cached: 0,
        inUse: 0,
        unresolvedKeys: [],
        unresolvedBytes: 0,
        retainedCapacityBytes: 0,
        highWaterBytes: 100_000_000,
      },
    });
    await expect(release).resolves.toMatchObject({ released: [sessionKey] });
    expect(h.admission.getSnapshot()).toMatchObject({ reservedBytes: 0, residentBytes: 0 });
    h.host.dispose();
    vi.unstubAllGlobals();
  });

  it('terminates the worker when a created session exceeds its reserved estimate', async () => {
    const h = makeHost();
    const pending = h.host.infer(workerRequest('depth', '/models/depth.onnx', 'depth', 100), {
      reservationBytes: 20,
    });
    const worker = h.worker;
    const requestId = requestIdOf(worker);
    const sessionKey = sessionKeyFrom(worker);
    worker.emit({
      type: 'session-ready',
      requestId,
      sessionKey,
      modelType: 'depth',
      modelPath: '/models/depth.onnx',
      estimateBytes: 101,
      evictedKeys: [],
    });

    await expect(pending).rejects.toMatchObject({ code: 'worker_crash' });
    expect(worker.terminated).toBe(true);
    expect(h.host.getResidencyDiagnostics()).toMatchObject({ residentSessions: 0 });
    expect(h.admission.getSnapshot()).toMatchObject({ reservedBytes: 0, residentBytes: 0 });
    vi.unstubAllGlobals();
  });

  it('rekeys a queued inference when its worker generation changes before admission', async () => {
    const h = makeHost();
    const first = h.host.infer(workerRequest('scunet', '/first.onnx'), {
      reservationBytes: 0,
    });
    const firstWorker = h.worker;
    const firstId = requestIdOf(firstWorker);
    firstWorker.emit({ type: 'result', requestId: firstId, outputs: {} });
    await expect(first).resolves.toMatchObject({ type: 'result' });

    const blocker = h.admission.tryAcquire({ kind: 'other', reservationBytes: 0 });
    expect(blocker).not.toBeNull();
    const queued = h.host.infer(workerRequest('scunet', '/next.onnx', 'scunet', 100), {
      timeoutMs: 5000,
      reservationBytes: 10,
    });
    await vi.waitFor(() => expect(h.admission.getSnapshot().pending).toBe(1));

    h.host.dispose();
    expect(firstWorker.terminated).toBe(true);
    blocker!.release();
    await vi.waitFor(() => expect(h.host.pendingCount).toBe(1));

    const nextWorker = h.worker;
    const request = nextWorker.posted[0] as WorkerInferRequest;
    expect(request.sessionIdentity?.deviceGeneration).toBe(2);
    const requestId = requestIdOf(nextWorker);
    const sessionKey = sessionKeyFrom(nextWorker);
    nextWorker.emit({
      type: 'session-ready',
      requestId,
      sessionKey,
      modelType: request.modelType,
      modelPath: request.modelPath,
      estimateBytes: 100,
      evictedKeys: [],
    });
    nextWorker.emit({ type: 'result', requestId, outputs: {} });
    await expect(queued).resolves.toMatchObject({ type: 'result' });
    h.host.dispose();
    vi.unstubAllGlobals();
  });

  it('keeps a failed-release session resident without charging it twice on reuse', async () => {
    const h = makeHost();
    const first = h.host.infer(workerRequest('scunet', '/m.onnx', 'scunet', 100_000_000), {
      reservationBytes: 20_000_000,
    });
    const firstId = requestIdOf(h.worker);
    const sessionKey = emitSessionReady(h.worker, firstId, 100_000_000);
    h.worker.emit({ type: 'result', requestId: firstId, outputs: {} });
    await expect(first).resolves.toMatchObject({ type: 'result' });

    const release = h.host.releaseModel('scunet', '/m.onnx');
    const releaseMessage = h.worker.posted[1] as WorkerReleaseRequest;
    h.worker.emit({
      type: 'released',
      requestId: releaseMessage.requestId,
      released: [],
      failed: [{ key: sessionKey, message: 'release unavailable' }],
      inUse: [],
      possiblyResidentBytes: 100_000_000,
      remaining: 1,
      snapshot: {
        cached: 1,
        inUse: 0,
        unresolvedKeys: [sessionKey],
        unresolvedBytes: 100_000_000,
        retainedCapacityBytes: 100_000_000,
        highWaterBytes: 100_000_000,
      },
    });
    await expect(release).resolves.toMatchObject({ failed: [{ key: sessionKey }] });
    expect(h.admission.getSnapshot()).toMatchObject({ residentBytes: 100_000_000 });
    expect(h.host.getResidencyDiagnostics().unresolvedBytes).toBe(0);

    const reuse = h.host.infer(workerRequest('scunet', '/m.onnx', 'scunet', 100_000_000), {
      reservationBytes: 20_000_000,
    });
    const reuseId = (h.worker.posted[2] as { requestId: string }).requestId;
    expect(h.admission.getSnapshot()).toMatchObject({ reservedBytes: 120_000_000 });
    h.worker.emit({ type: 'result', requestId: reuseId, outputs: { reused: true } });
    await expect(reuse).resolves.toMatchObject({ outputs: { reused: true } });
    h.host.dispose();
    expect(h.admission.getSnapshot()).toMatchObject({ residentBytes: 0, reservedBytes: 0 });
    vi.unstubAllGlobals();
  });
});
