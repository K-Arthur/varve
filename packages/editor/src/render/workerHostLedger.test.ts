/**
 * Exactly-once frame accounting, asserted through the real worker host rather
 * than against the ledger in isolation — these are the paths that actually
 * decide whether a browser graphics resource is released.
 */
import { asRenderRevision } from '@strata/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderWorkerHost, disposeWorkerFrame, type WorkerCommand } from './workerHost';

const mockWorkers: MockWorker[] = [];

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(_url: URL | string, _opts?: WorkerOptions) {
    mockWorkers.push(this);
  }
}

function mockBitmap(width = 2, height = 2): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function renderCommand(
  overrides: Partial<Extract<WorkerCommand, { type: 'render' }>> = {},
): Extract<WorkerCommand, { type: 'render' }> {
  return {
    type: 'render',
    ir: [],
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    viewport: { width: 100, height: 100 },
    docVersion: 1,
    dpr: 1,
    ...overrides,
  };
}

function frameResponse(bitmap: ImageBitmap, revision = 1, overrides: Record<string, unknown> = {}) {
  return {
    type: 'frameRendered' as const,
    docVersion: revision,
    renderRevision: asRenderRevision(revision),
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    viewport: { width: 100, height: 100 },
    dpr: 1,
    bitmap,
    ...overrides,
  };
}

function deliver(data: unknown): void {
  mockWorkers[0]!.onmessage!(new MessageEvent('message', { data }));
}

describe('worker host frame ledger', () => {
  beforeEach(() => {
    mockWorkers.length = 0;
    (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas ??= class {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { Worker?: typeof MockWorker }).Worker;
  });

  it('accounts a presented frame exactly once', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, { budgetBytes: 1_000_000 })!;
    host.post(renderCommand());
    deliver(frameResponse(mockBitmap()));
    const state = host.getFrameLedgerState();
    expect(state.created).toBe(1);
    expect(state.installed).toBe(1);
    expect(state.residentBytes).toBe(16);
    expect(state.duplicateCloseAttempts).toBe(0);
  });

  it('releases the prior frame exactly once when a newer one replaces it', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, { budgetBytes: 1_000_000 })!;
    host.post(renderCommand());
    deliver(frameResponse(mockBitmap()));
    host.post(renderCommand({ docVersion: 2, renderRevision: asRenderRevision(2) }));
    deliver(frameResponse(mockBitmap(), 2));
    const state = host.getFrameLedgerState();
    expect(state.created).toBe(2);
    expect(state.replaced).toBe(1);
    expect(state.closed).toBe(1);
    // Only the newest frame is resident; the replaced one was released once.
    expect(state.residentBytes).toBe(16);
    // The release happens before the replacement is accounted, so the host
    // never counts two resident frames at once even momentarily.
    expect(state.peakResidentBytes).toBe(16);
  });

  it('counts a discarded stale frame without ever marking it resident', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, { budgetBytes: 1_000_000 })!;
    host.post(renderCommand());
    // A response whose viewport identity no longer matches the latest render.
    deliver(frameResponse(mockBitmap(), 1, { viewport: { width: 640, height: 480 } }));
    const state = host.getFrameLedgerState();
    expect(state.stale).toBe(1);
    expect(state.installed).toBe(0);
    expect(state.residentBytes).toBe(0);
    expect(state.closed).toBe(1);
  });

  it('makes a duplicate host-side close idempotent and observable', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, { budgetBytes: 1_000_000 })!;
    host.post(renderCommand());
    const frame = mockBitmap();
    deliver(frameResponse(frame));

    disposeWorkerFrame(host, frame);
    expect(host.getFrameLedgerState().residentBytes).toBe(0);
    // A second disposal of the same bitmap must not double-release.
    disposeWorkerFrame(host, frame);
    disposeWorkerFrame(host, frame);
    const state = host.getFrameLedgerState();
    expect(state.residentBytes).toBe(0);
    expect(state.duplicateCloseAttempts).toBe(2);
    expect(state.closed).toBe(1);
  });

  it('reconciles resident accounting to zero on terminate', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, { budgetBytes: 1_000_000 })!;
    host.post(renderCommand());
    deliver(frameResponse(mockBitmap()));
    expect(host.getFrameLedgerState().residentBytes).toBe(16);

    host.terminate();
    const state = host.getFrameLedgerState();
    expect(state.residentBytes).toBe(0);
    expect(state.orphanRecoveries).toBe(1);
    expect(host.getBitmapBudgetState().residentBytes).toBe(0);
  });

  it('cannot be resurrected by a late response after teardown', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, { budgetBytes: 1_000_000 })!;
    host.post(renderCommand());
    const frame = mockBitmap();
    deliver(frameResponse(frame));
    host.terminate();

    // A response that lands after teardown must neither install nor account.
    deliver(frameResponse(mockBitmap(), 2));
    disposeWorkerFrame(host, frame);
    const state = host.getFrameLedgerState();
    expect(state.residentBytes).toBe(0);
    expect(state.installed).toBe(1);
  });

  it('never lets accounting go negative under repeated stale releases', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, { budgetBytes: 1_000_000 })!;
    host.post(renderCommand());
    deliver(frameResponse(mockBitmap()));
    const foreign = mockBitmap();
    for (let i = 0; i < 10; i++) expect(host.releaseFrame(foreign)).toBe(false);
    expect(host.getFrameLedgerState().residentBytes).toBe(16);
    expect(host.getBitmapBudgetState().residentBytes).toBeGreaterThanOrEqual(0);
  });
});
