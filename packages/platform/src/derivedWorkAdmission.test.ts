import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DERIVED_WORK_MEMORY_LIMITS,
  DerivedWorkAdmission,
  DerivedWorkAdmissionError,
  type DerivedWorkPriority,
} from './derivedWorkAdmission';

afterEach(() => vi.useRealTimers());

const request = (id: string, priority: DerivedWorkPriority = 'background') => ({
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

  it('uses the conservative default ceiling and the explicit 8 GB reference profile', () => {
    const conservative = new DerivedWorkAdmission();
    const reference = new DerivedWorkAdmission({ memoryProfile: 'reference-8gb' });
    expect(conservative.snapshot().maxReservedBytes).toBe(
      DERIVED_WORK_MEMORY_LIMITS['unknown-or-4gb'],
    );
    expect(reference.snapshot().maxReservedBytes).toBe(DERIVED_WORK_MEMORY_LIMITS['reference-8gb']);
    reference.setMemoryProfile('unknown-or-4gb');
    expect(reference.snapshot().maxReservedBytes).toBe(
      DERIVED_WORK_MEMORY_LIMITS['unknown-or-4gb'],
    );
  });

  it('refuses an over-budget request before it owns a slot or bytes', () => {
    const gate = new DerivedWorkAdmission({ maxReservedBytes: 100 });
    expect(() => gate.tryAcquire({ ...request('too-large'), estimatedBytes: 101 })).toThrowError(
      expect.objectContaining({ code: 'memory-limit' }),
    );
    expect(gate.snapshot()).toMatchObject({ active: 0, pending: 0, reservedBytes: 0 });
  });

  it('transfers job reservation to a resident lease without double counting, then evicts it first', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const work = await gate.acquire({
      ...request('session-create', 'visible'),
      kind: 'inference',
      estimatedBytes: 100,
    });
    let evicted = false;
    const resident = work.retainResident(70, {
      key: 'session:scunet',
      priority: 'idle',
      onEvict: () => {
        evicted = true;
        return true;
      },
    });
    expect(gate.snapshot()).toMatchObject({
      activeBytes: 30,
      residentBytes: 70,
      reservedBytes: 100,
    });
    work.release();
    expect(gate.snapshot()).toMatchObject({ activeBytes: 0, residentBytes: 70, reservedBytes: 70 });

    const replacement = gate.tryAcquire({
      ...request('visible-filter', 'visible'),
      kind: 'effect',
      estimatedBytes: 50,
    });
    expect(evicted).toBe(true);
    expect(gate.snapshot()).toMatchObject({ active: 1, activeBytes: 50, residentBytes: 0 });
    resident.release();
    replacement?.release();
  });

  it('rejects resident transfer overflow without changing the active reservation', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const work = await gate.acquire({ ...request('small-session'), estimatedBytes: 10 });
    expect(() => work.retainResident(11)).toThrowError(
      expect.objectContaining({ code: 'reservation-overflow' }),
    );
    expect(gate.snapshot()).toMatchObject({ activeBytes: 10, residentBytes: 0, reservedBytes: 10 });
    work.release();
  });

  it('keeps failed resident eviction accounted and refuses the new allocation', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const work = await gate.acquire({ ...request('cache-build'), estimatedBytes: 80 });
    work.retainResident(80, { onEvict: () => false });
    work.release();

    expect(gate.tryAcquire({ ...request('large-preview', 'visible'), estimatedBytes: 40 })).toBe(
      null,
    );
    expect(gate.snapshot()).toMatchObject({
      residentBytes: 80,
      reservedBytes: 80,
      evictionFailures: 1,
    });
  });

  it('retains bytes until asynchronous resident disposal confirms release', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const work = await gate.acquire({ ...request('session-create'), estimatedBytes: 100 });
    let confirmRelease!: (released: boolean) => void;
    work.retainResident(80, {
      priority: 'idle',
      onEvict: () => new Promise<boolean>((resolve) => (confirmRelease = resolve)),
    });
    work.release();
    const waiting = gate.acquire({
      ...request('effect', 'visible'),
      kind: 'effect',
      estimatedBytes: 40,
    });

    expect(gate.snapshot()).toMatchObject({
      active: 0,
      pending: 1,
      residentBytes: 80,
      reservedBytes: 80,
    });
    confirmRelease(true);
    const admitted = await waiting;
    expect(gate.snapshot()).toMatchObject({ activeBytes: 40, residentBytes: 0, reservedBytes: 40 });
    admitted.release();
  });

  it('keeps resident bytes accounted when asynchronous eviction fails', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, maxReservedBytes: 100 });
    const work = await gate.acquire({ ...request('failed-session-create'), estimatedBytes: 100 });
    const resident = work.retainResident(80, {
      priority: 'idle',
      onEvict: () => Promise.reject(new Error('release failed')),
    });
    work.release();
    const controller = new AbortController();
    const waiting = gate.acquire({
      ...request('blocked-effect', 'visible'),
      kind: 'effect',
      estimatedBytes: 40,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(gate.snapshot()).toMatchObject({
        pending: 1,
        residentBytes: 80,
        reservedBytes: 80,
        evictionFailures: 1,
      });
    });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
    expect(gate.snapshot().residentBytes).toBe(80);
    resident.release();
  });

  it('promotes a waiting explicit export by age while preserving FIFO at the promoted tier', async () => {
    vi.useFakeTimers();
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1, priorityAgingMs: 1_000 });
    const active = await gate.acquire({ ...request('active', 'visible'), estimatedBytes: 1 });
    const exportWork = gate.acquire({
      ...request('export', 'explicit-export'),
      kind: 'export',
      estimatedBytes: 1,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const foreground = gate.acquire({
      ...request('new-foreground', 'foreground'),
      estimatedBytes: 1,
    });

    active.release();
    const first = await exportWork;
    expect(first.id).toBe('export');
    first.release();
    const second = await foreground;
    expect(second.id).toBe('new-foreground');
    second.release();
    vi.useRealTimers();
  });

  it('continues an explicit export while paused but holds speculative preview work', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1 });
    const active = await gate.acquire(request('active'));
    const preview = gate.acquire({ ...request('preview', 'visible'), kind: 'effect' });
    const exportWork = gate.acquire({
      ...request('export', 'explicit-export'),
      kind: 'export',
    });
    gate.pause();
    expect(active.signal.aborted).toBe(true);
    active.release();

    const admittedExport = await exportWork;
    expect(admittedExport.id).toBe('export');
    admittedExport.release();
    expect(gate.snapshot()).toMatchObject({ active: 0, pending: 1, paused: true });
    gate.resume();
    const admittedPreview = await preview;
    expect(admittedPreview.id).toBe('preview');
    admittedPreview.release();
  });

  it('refuses speculative try-acquire calls while paused and admits explicit export work', () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 1 });
    gate.pause();
    expect(gate.tryAcquire({ ...request('hidden-preview', 'visible'), kind: 'effect' })).toBeNull();
    const exportLease = gate.tryAcquire({
      ...request('hidden-export', 'explicit-export'),
      kind: 'export',
      estimatedBytes: 10,
    });
    expect(exportLease?.id).toBe('hidden-export');
    exportLease?.release();
  });
});
