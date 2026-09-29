import { afterEach, describe, expect, it, vi } from 'vitest';
import { InferenceAdmission } from '../admission';
import { InferenceWorkerHost } from '../inferenceWorkerHost';

/**
 * The host installed a readiness probe that replaced its message handler with
 * one forwarding only `ready` and discarding everything else. The worker emits
 * `ready` *after* creating a session inside an infer request, so any failure
 * before that point posted an `error` that was dropped — the caller then waited
 * out its full timeout (5 minutes for denoise) with no diagnostic at all.
 */
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

describe('InferenceWorkerHost message handling', () => {
  it('surfaces a worker error instead of waiting out the timeout', async () => {
    const h = makeHost();
    const pending = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/m.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 5000 },
    );
    const requestId = requestIdOf(h.worker);
    // An error arriving before any `ready` must still reach the caller.
    h.worker.emit({ type: 'error', requestId, message: 'Model exceeds safe WASM memory limit.' });
    await expect(pending).rejects.toThrow(/exceeds safe WASM/);
    vi.unstubAllGlobals();
  });

  it('resolves a result that arrives without a preceding ready message', async () => {
    const h = makeHost();
    const pending = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/m.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 5000 },
    );
    const requestId = requestIdOf(h.worker);
    h.worker.emit({ type: 'result', requestId, outputs: { out: 42 } });
    await expect(pending).resolves.toMatchObject({ outputs: { out: 42 } });
    vi.unstubAllGlobals();
  });

  it('detaches a cancelled request without terminating unrelated worker work', async () => {
    const h = makeHost();
    const controller = new AbortController();
    const pending = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/m.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 5000, signal: controller.signal, reservationBytes: 5_000_000 },
    );
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
    const replacement = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/next.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 5000, reservationBytes: 3_000_000 },
    );
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
    const pending = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/m.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 10, signal: controller.signal, reservationBytes: 7_000_000 },
    );
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
    const pending = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/m.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 5000, reservationBytes: 9_000_000 },
    );
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
    const pending = h.host.infer(
      { type: 'infer', modelType: 'scunet', modelPath: '/m.onnx', modelId: 'scunet' } as never,
      { timeoutMs: 5000, signal: controller.signal, reservationBytes: 4_000_000 },
    );
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
    const pending = h.host.infer(
      { type: 'infer', modelType: 'detr', modelPath: '/m.onnx', modelId: 'detr' } as never,
      { timeoutMs: 10 },
    );
    const rejection = expect(pending).rejects.toThrow(/timed out/i);
    const firstWorker = h.worker;
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    expect(firstWorker.terminated).toBe(true);

    const retry = h.host.infer(
      { type: 'infer', modelType: 'detr', modelPath: '/m.onnx', modelId: 'detr' } as never,
      { timeoutMs: 100 },
    );
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
});
