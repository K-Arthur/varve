import { DerivedWorkAdmission } from '@varve/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EffectDispatchRequest } from '../dispatch';
import {
  type EffectPreviewIdentity,
  EffectPreviewJobError,
  type EffectPreviewJobInput,
  EffectPreviewRunner,
  type EffectPreviewWorkerPort,
  type EffectPreviewWorkerRequest,
  type EffectPreviewWorkerResponse,
  ModuleEffectPreviewExecutor,
  sameEffectPreviewIdentity,
} from '../effectPreviewRunner';

function makeRequest(width = 2, height = 2): EffectDispatchRequest {
  return {
    effect: 'rgbSplit',
    width,
    height,
    quality: 'interactive',
    params: { mode: 'offset', redX: 1, intensity: 1, quality: 'auto' },
  };
}

function makeIdentity(ownerId = 'tile-a', generation = 1): EffectPreviewIdentity {
  return {
    ownerId,
    documentId: 'document-a',
    targetId: 'node-a',
    sourceRevision: 'source-1',
    parameterRevision: 'params-1',
    maskRevision: 'mask-1',
    timeRevision: 12.5,
    generation,
  };
}

function makeInput(overrides: Partial<EffectPreviewJobInput> = {}): EffectPreviewJobInput {
  const request = makeRequest();
  return {
    identity: makeIdentity(),
    request,
    captureSource: () => new Uint8ClampedArray(request.width * request.height * 4).fill(80),
    isCurrent: () => true,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class ControlledExecutor {
  readonly calls: Array<{
    request: EffectDispatchRequest;
    input: Uint8ClampedArray;
    result: ReturnType<typeof deferred<Uint8ClampedArray>>;
  }> = [];
  prepared = true;

  prepare(): boolean {
    return this.prepared;
  }

  apply(request: EffectDispatchRequest, input: Uint8ClampedArray) {
    const result = deferred<Uint8ClampedArray>();
    this.calls.push({ request, input, result });
    return result.promise;
  }

  dispose(): void {
    for (const call of this.calls) {
      call.result.reject(new EffectPreviewJobError('cancelled', 'Executor terminated'));
    }
  }

  complete(index: number): void {
    const call = this.calls[index]!;
    call.result.resolve(new Uint8ClampedArray(call.input.length).fill(120));
  }
}

class FakeWorker implements EffectPreviewWorkerPort {
  onmessage: ((event: MessageEvent<EffectPreviewWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  message: EffectPreviewWorkerRequest | null = null;
  transfer: Transferable[] = [];
  terminated = false;

  postMessage(message: EffectPreviewWorkerRequest, transfer: Transferable[]): void {
    this.message = message;
    this.transfer = transfer;
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: EffectPreviewWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<EffectPreviewWorkerResponse>);
  }
}

async function waitForCall(executor: ControlledExecutor, count = 1): Promise<void> {
  await vi.waitFor(() => expect(executor.calls).toHaveLength(count));
}

afterEach(() => vi.useRealTimers());

describe('live effect preview runner', () => {
  it('does not capture the source until the shared byte gate admits the job', async () => {
    const admission = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 1024 });
    const blocker = await admission.acquire({
      id: 'export-blocker',
      kind: 'export',
      priority: 'explicit-export',
      estimatedBytes: 128,
    });
    const executor = new ControlledExecutor();
    const runner = new EffectPreviewRunner({ admission, executor });
    const capture = vi.fn(() => new Uint8ClampedArray(16).fill(10));
    const preview = runner.submit(makeInput({ captureSource: capture }));

    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
    blocker.release();
    await waitForCall(executor);
    expect(capture).toHaveBeenCalledOnce();
    executor.complete(0);
    await expect(preview).resolves.toHaveLength(16);
    expect(admission.snapshot().activeBytes).toBe(0);
    runner.dispose();
  });

  it('refuses an over-budget surface before decoding or allocating its RGBA capture', async () => {
    const admission = new DerivedWorkAdmission({ maxReservedBytes: 100 });
    const executor = new ControlledExecutor();
    const runner = new EffectPreviewRunner({ admission, executor });
    const capture = vi.fn(() => new Uint8ClampedArray(64));
    const promise = runner.submit(
      makeInput({ request: makeRequest(4, 4), captureSource: capture }),
    );

    await expect(promise).rejects.toMatchObject({ code: 'memory-limit' });
    expect(capture).not.toHaveBeenCalled();
    expect(executor.calls).toHaveLength(0);
    runner.dispose();
  });

  it('keeps one running request and one replaceable pending request per owner', async () => {
    const admission = new DerivedWorkAdmission({ maxReservedBytes: 1024 });
    const executor = new ControlledExecutor();
    const runner = new EffectPreviewRunner({ admission, executor });
    let currentGeneration = 1;
    const forGeneration = (generation: number) =>
      makeInput({
        identity: makeIdentity('gallery-card', generation),
        isCurrent: (identity) => identity.generation === currentGeneration,
      });
    const first = runner.submit(forGeneration(1));
    const firstRejected = first.catch((error) => error);
    await waitForCall(executor);

    currentGeneration = 2;
    const obsolete = runner.submit(forGeneration(2));
    const obsoleteRejected = obsolete.catch((error) => error);
    currentGeneration = 3;
    const latest = runner.submit(forGeneration(3));

    await expect(firstRejected).resolves.toMatchObject({ code: 'superseded' });
    await expect(obsoleteRejected).resolves.toMatchObject({ code: 'superseded' });
    expect(runner.getSnapshot()).toMatchObject({ activeOwnerId: 'gallery-card', pendingOwners: 1 });
    executor.complete(0);
    await waitForCall(executor, 2);
    expect(executor.calls[1]!.request.params).toEqual(forGeneration(3).request.params);
    executor.complete(1);
    await expect(latest).resolves.toHaveLength(16);
    expect(runner.getSnapshot()).toMatchObject({ pendingOwners: 0, completed: 1, superseded: 2 });
    runner.dispose();
  });

  it('rejects a cancelled caller promptly but retains bytes until worker completion', async () => {
    const admission = new DerivedWorkAdmission({ maxReservedBytes: 1024 });
    const executor = new ControlledExecutor();
    const runner = new EffectPreviewRunner({ admission, executor });
    const preview = runner.submit(makeInput());
    const rejected = preview.catch((error) => error);
    await waitForCall(executor);

    runner.cancelOwner('tile-a');
    await expect(rejected).resolves.toMatchObject({ code: 'cancelled' });
    expect(admission.snapshot()).toMatchObject({ active: 1, activeBytes: 48 });
    executor.complete(0);
    await vi.waitFor(() =>
      expect(admission.snapshot()).toMatchObject({ active: 0, activeBytes: 0 }),
    );
    expect(runner.getSnapshot()).toMatchObject({ cancelled: 1, completed: 0 });
    runner.dispose();
  });

  it('drops a late frame when any external identity revision is no longer current', async () => {
    const executor = new ControlledExecutor();
    const runner = new EffectPreviewRunner({
      admission: new DerivedWorkAdmission({ maxReservedBytes: 1024 }),
      executor,
    });
    let current = true;
    const preview = runner.submit(makeInput({ isCurrent: () => current }));
    const rejected = preview.catch((error) => error);
    await waitForCall(executor);
    current = false;
    executor.complete(0);
    await expect(rejected).resolves.toMatchObject({ code: 'cancelled' });
    expect(runner.getSnapshot()).toMatchObject({ completed: 0, cancelled: 1 });
    runner.dispose();
  });

  it('requires exact transferable RGBA bytes and exposes all stale identity fields', () => {
    const identity = makeIdentity();
    const changed = [
      { ...identity, ownerId: 'owner-b' },
      { ...identity, documentId: 'document-b' },
      { ...identity, targetId: 'node-b' },
      { ...identity, sourceRevision: 'source-2' },
      { ...identity, parameterRevision: 'params-2' },
      { ...identity, maskRevision: 'mask-2' },
      { ...identity, timeRevision: 13 },
      { ...identity, generation: identity.generation + 1 },
    ];
    for (const candidate of changed) {
      expect(sameEffectPreviewIdentity(identity, candidate)).toBe(false);
    }
    expect(sameEffectPreviewIdentity(identity, { ...identity })).toBe(true);
  });

  it('does not capture when module worker construction fails', async () => {
    const executor = new ModuleEffectPreviewExecutor(() => {
      throw new Error('CSP denied worker');
    });
    const runner = new EffectPreviewRunner({
      admission: new DerivedWorkAdmission({ maxReservedBytes: 1024 }),
      executor,
    });
    const capture = vi.fn(() => new Uint8ClampedArray(16));
    await expect(runner.submit(makeInput({ captureSource: capture }))).rejects.toMatchObject({
      code: 'worker-unavailable',
    });
    expect(capture).not.toHaveBeenCalled();
    runner.dispose();
  });

  it('transfers RGBA input and validates the worker result identity and byte length', async () => {
    const worker = new FakeWorker();
    const executor = new ModuleEffectPreviewExecutor(() => worker);
    expect(executor.prepare()).toBe(true);
    const rgba = new Uint8ClampedArray(16).fill(3);
    const promise = executor.apply(makeRequest(), rgba);
    expect(worker.message).toMatchObject({ type: 'apply', id: 1, request: makeRequest() });
    expect(worker.transfer).toEqual([rgba.buffer]);

    const output = new Uint8Array(16).fill(7).buffer;
    worker.reply({ type: 'result', id: 1, rgba: output });
    await expect(promise).resolves.toEqual(new Uint8ClampedArray(16).fill(7));

    const wrongSize = executor.apply(makeRequest(), new Uint8ClampedArray(16));
    worker.reply({ type: 'result', id: 2, rgba: new Uint8Array(4).buffer });
    await expect(wrongSize).rejects.toMatchObject({ code: 'worker-failed' });
    executor.dispose();
  });

  it('terminates a worker that misses its response deadline', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const executor = new ModuleEffectPreviewExecutor(() => worker, 25);
    expect(executor.prepare()).toBe(true);
    const pending = executor.apply(makeRequest(), new Uint8ClampedArray(16));
    const rejected = expect(pending).rejects.toMatchObject({ code: 'worker-failed' });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(worker.terminated).toBe(true);
  });
});
