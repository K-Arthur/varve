import { DerivedWorkAdmission } from '@varve/platform';
import { describe, expect, it } from 'vitest';
import { estimateInferenceReservation, InferenceAdmission } from './admission';

describe('InferenceAdmission', () => {
  it('runs one heavy request at a time and admits the FIFO waiter on release', async () => {
    const admission = new InferenceAdmission({ maxConcurrent: 1 });
    const first = admission.tryAcquire({ kind: 'generation', reservationBytes: 10 });
    expect(first).not.toBeNull();

    const secondPromise = admission.acquire({ kind: 'worker', reservationBytes: 20 });
    expect(admission.getSnapshot()).toMatchObject({ active: 1, pending: 1, reservedBytes: 10 });

    first?.release();
    const second = await secondPromise;
    expect(second.kind).toBe('worker');
    expect(admission.getSnapshot()).toMatchObject({ active: 1, pending: 0, reservedBytes: 20 });

    second.release();
    second.release();
    expect(admission.getSnapshot()).toMatchObject({ active: 0, pending: 0, reservedBytes: 0 });
  });

  it('removes an aborted waiter without disturbing the active lease', async () => {
    const admission = new InferenceAdmission({ maxConcurrent: 1 });
    const active = admission.tryAcquire({ kind: 'other' });
    const controller = new AbortController();
    const waiting = admission.acquire({
      kind: 'background-removal',
      signal: controller.signal,
      label: 'photo cutout',
    });

    controller.abort();
    await expect(waiting).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(admission.getSnapshot()).toMatchObject({ active: 1, pending: 0 });

    active?.release();
    expect(admission.getSnapshot().active).toBe(0);
  });

  it('rejects a request whose reservation exceeds the configured memory ceiling', () => {
    const admission = new InferenceAdmission({ maxReservedBytes: 100 });
    expect(() => admission.tryAcquire({ kind: 'generation', reservationBytes: 101 })).toThrowError(
      expect.objectContaining({ code: 'insufficient-memory' }),
    );
  });

  it('estimates the largest RGBA frame plus model and staging memory', () => {
    expect(
      estimateInferenceReservation({
        width: 10,
        height: 20,
        outputWidth: 20,
        outputHeight: 10,
        additionalBytes: 100,
        modelBytes: 200,
        workingSetMultiplier: 2,
      }),
    ).toBe(1_900);
  });

  it('rejects invalid reservation dimensions and multipliers', () => {
    expect(() => estimateInferenceReservation({ width: 0, height: 1 })).toThrow(
      /dimensions must be positive/,
    );
    expect(() =>
      estimateInferenceReservation({ width: 1, height: 1, workingSetMultiplier: 0.5 }),
    ).toThrow(/multiplier must be at least one/);
  });

  it('notifies subscribers on acquire, queueing, abort, and release, and stops after unsubscribe', async () => {
    const admission = new InferenceAdmission({ maxConcurrent: 1 });
    let calls = 0;
    const unsubscribe = admission.subscribe(() => {
      calls += 1;
    });

    const first = admission.tryAcquire({ kind: 'generation', reservationBytes: 1 });
    expect(calls).toBe(1);

    const controller = new AbortController();
    const secondPromise = admission.acquire({
      kind: 'worker',
      reservationBytes: 1,
      signal: controller.signal,
    });
    expect(calls).toBe(2); // queued

    controller.abort();
    await expect(secondPromise).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls).toBe(3); // removed from queue

    first?.release();
    expect(calls).toBe(4);

    unsubscribe();
    admission.tryAcquire({ kind: 'other', reservationBytes: 1 })?.release();
    expect(calls).toBe(4); // no further notifications after unsubscribe
  });

  it('shares byte reservations and queue ordering with platform derived work', async () => {
    const shared = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const inference = new InferenceAdmission({ admission: shared });
    const thumbnail = await shared.acquire({
      id: 'thumbnail:page-1',
      kind: 'thumbnail',
      priority: 'background',
      estimatedBytes: 70,
    });
    const inferenceWaiter = inference.acquire({
      kind: 'worker',
      reservationBytes: 40,
      label: 'segmentation',
    });

    expect(shared.snapshot()).toMatchObject({
      active: 1,
      pending: 1,
      activeBytes: 70,
      pendingBytes: 40,
      reservedBytes: 70,
    });
    expect(inference.getSnapshot()).toMatchObject({ active: 0, pending: 1, reservedBytes: 0 });

    thumbnail.release();
    const inferenceLease = await inferenceWaiter;
    expect(inference.getSnapshot()).toMatchObject({
      active: 1,
      pending: 0,
      activeBytes: 40,
      reservedBytes: 40,
      maxReservedBytes: 100,
    });
    inferenceLease.release();
    expect(shared.snapshot()).toMatchObject({ active: 0, pending: 0, reservedBytes: 0 });
  });

  it('transfers a session reservation to resident accounting and preserves it after job release', async () => {
    const shared = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const inference = new InferenceAdmission({ admission: shared });
    const work = await inference.acquire({ kind: 'worker', reservationBytes: 90 });
    const resident = work.retainResident(60, { key: 'onnx:scunet', priority: 'idle' });

    expect(inference.getSnapshot()).toMatchObject({
      active: 1,
      activeBytes: 30,
      residentBytes: 60,
      reservedBytes: 90,
    });
    work.release();
    expect(inference.getSnapshot()).toMatchObject({
      active: 0,
      residentBytes: 60,
      reservedBytes: 60,
    });
    resident.release();
    expect(shared.snapshot().reservedBytes).toBe(0);
  });

  it('maps over-ceiling and malformed estimates to concrete inference refusal reasons', async () => {
    const inference = new InferenceAdmission({ maxReservedBytes: 100 });
    await expect(
      inference.acquire({ kind: 'worker', reservationBytes: 101 }),
    ).rejects.toMatchObject({ code: 'insufficient-memory' });
    expect(() => inference.acquire({ kind: 'worker', reservationBytes: Number.NaN })).toThrow(
      expect.objectContaining({ code: 'invalid-estimate' }),
    );
    expect(inference.getSnapshot()).toMatchObject({ active: 0, pending: 0, reservedBytes: 0 });
  });

  it('admits an explicit export ahead of a queued inference request', async () => {
    const shared = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const inference = new InferenceAdmission({ admission: shared });
    const active = await inference.acquire({ kind: 'worker', reservationBytes: 10 });
    const waitingInference = inference.acquire({ kind: 'worker', reservationBytes: 10 });
    const waitingExport = inference.acquire({ kind: 'export', reservationBytes: 10 });

    active.release();
    const exportLease = await waitingExport;
    expect(exportLease.kind).toBe('export');
    expect(inference.getSnapshot()).toMatchObject({ active: 1, pending: 1 });
    exportLease.release();
    (await waitingInference).release();
  });
});
