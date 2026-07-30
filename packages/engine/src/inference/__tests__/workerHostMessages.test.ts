import { describe, expect, it, vi } from 'vitest';
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
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {}
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
  vi.stubGlobal('Worker', StubWorker as unknown as typeof Worker);
  const host = new InferenceWorkerHost('about:blank');
  return {
    host,
    get worker(): FakeWorker {
      if (!created) throw new Error('host never constructed a worker');
      return created;
    },
  };
}

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
});
