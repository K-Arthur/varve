import { describe, expect, it } from 'vitest';
import { DerivedWorkAdmission, DerivedWorkAdmissionError } from './derivedWorkAdmission';

const request = (
  id: string,
  priority: 'visible' | 'current-document' | 'background' | 'idle' = 'background',
) => ({
  id,
  kind: 'other' as const,
  priority,
});

describe('DerivedWorkAdmission', () => {
  it('orders queued work by priority while preserving FIFO within a tier', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, maxPending: 8 });
    const first = await gate.acquire(request('first'));
    const low = gate.acquire(request('low', 'idle'));
    const current = gate.acquire(request('current', 'current-document'));
    const visible = gate.acquire(request('visible', 'visible'));
    first.release();
    expect((await visible).id).toBe('visible');
    (await visible).release();
    expect((await current).id).toBe('current');
    (await current).release();
    expect((await low).id).toBe('low');
    (await low).release();
    expect(gate.snapshot()).toMatchObject({ active: 0, pending: 0, completed: 4 });
  });

  it('evicts the oldest lower-priority pending request when full', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, maxPending: 1 });
    const active = await gate.acquire(request('active'));
    const low = gate.acquire(request('low', 'idle'));
    const high = gate.acquire(request('high', 'visible'));
    await expect(low).rejects.toMatchObject({ code: 'queue-full' });
    active.release();
    expect((await high).id).toBe('high');
    (await high).release();
    expect(gate.snapshot().rejected).toBe(1);
  });

  it('removes an aborted pending request and aborts an admitted lease', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1 });
    const activeController = new AbortController();
    const active = await gate.acquire({ ...request('active'), signal: activeController.signal });
    const pendingController = new AbortController();
    const pending = gate.acquire({ ...request('pending'), signal: pendingController.signal });
    pendingController.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    activeController.abort();
    expect(active.signal.aborted).toBe(true);
    active.release();
  });

  it('rejects work after disposal and aborts active leases', async () => {
    const gate = new DerivedWorkAdmission();
    const lease = await gate.acquire(request('active'));
    gate.dispose();
    expect(lease.signal.aborted).toBe(true);
    await expect(gate.acquire(request('late'))).rejects.toBeInstanceOf(DerivedWorkAdmissionError);
  });
});
