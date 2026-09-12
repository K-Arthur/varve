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
});
