import { defaultBrushPreset, runWholeStroke, strokePoint } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BrushWorkerCommand,
  type BrushWorkerResponse,
  handleBrushCommand,
  resetBrushWorkerState,
} from '../brushWorker';
import { BrushWorkerHost, type StrokeBatchEvent } from '../brushWorkerHost';

/**
 * A Worker stand-in that runs the real worker module in-process. Delivery is
 * manually pumped so tests can hold responses back and exercise backpressure,
 * cancellation and timeouts deterministically.
 */
class FakeWorker {
  onmessage: ((e: MessageEvent<BrushWorkerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  received: BrushWorkerCommand[] = [];
  private outbox: BrushWorkerResponse[] = [];
  terminated = false;
  /** When true, responses queue until `flush()` is called. */
  manual = false;

  postMessage(cmd: BrushWorkerCommand): void {
    this.received.push(cmd);
    handleBrushCommand(
      cmd,
      (r) => {
        if (this.manual) this.outbox.push(r);
        else this.deliver(r);
      },
      () => 0,
    );
  }

  flush(): number {
    const pending = this.outbox.splice(0);
    for (const r of pending) this.deliver(r);
    return pending.length;
  }

  get queuedResponses(): number {
    return this.outbox.length;
  }

  private deliver(r: BrushWorkerResponse): void {
    if (this.terminated) return;
    this.onmessage?.({ data: r } as MessageEvent<BrushWorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const preset = () => ({
  ...defaultBrushPreset('t', 'T'),
  radius: 5,
  spacing: 0.25,
  smoothing: 0,
  positionJitter: 0.4,
  sizeJitter: 0.4,
});

function line(from: number, to: number, step: number) {
  const pts = [];
  for (let x = from; x <= to; x += step) pts.push(strokePoint(x, 0, { time: x }));
  return pts;
}

function collect(host: BrushWorkerHost): StrokeBatchEvent[] {
  const batches: StrokeBatchEvent[] = [];
  host.onBatch = (b) => batches.push(b);
  return batches;
}

describe('brush dispatch', () => {
  beforeEach(() => {
    resetBrushWorkerState();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('worker and sync paths produce identical dabs', () => {
    const points = line(0, 120, 4);
    const p = preset();

    const worker = new FakeWorker();
    const workerHost = new BrushWorkerHost(worker as unknown as Worker);
    const workerBatches = collect(workerHost);
    workerHost.beginStroke('s', 1, p, 12345);
    for (const pt of points) workerHost.appendPoints('s', 1, [pt]);
    workerHost.endStroke('s', 1);

    const syncHost = new BrushWorkerHost(null);
    const syncBatches = collect(syncHost);
    syncHost.beginStroke('s', 1, p, 12345);
    for (const pt of points) syncHost.appendPoints('s', 1, [pt]);
    syncHost.endStroke('s', 1);

    const workerDabs = workerBatches.flatMap((b) => b.dabs);
    const syncDabs = syncBatches.flatMap((b) => b.dabs);

    expect(workerBatches.some((b) => b.source === 'worker')).toBe(true);
    expect(syncBatches.every((b) => b.source === 'sync')).toBe(true);
    expect(workerDabs.length).toBeGreaterThan(10);
    expect(syncDabs).toEqual(workerDabs);
  });

  it('matches a single-shot engine run for the same seed', () => {
    const points = line(0, 80, 4);
    const p = preset();
    const host = new BrushWorkerHost(null);
    const batches = collect(host);
    host.beginStroke('s', 1, p, 777);
    for (const pt of points) host.appendPoints('s', 1, [pt]);
    host.endStroke('s', 1);

    const whole = runWholeStroke(p, points, 777);
    expect(batches.flatMap((b) => b.dabs)).toEqual(whole.dabs);
  });

  it('keeps at most one message in flight and merges the rest', () => {
    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    collect(host);
    host.beginStroke('s', 1, preset(), 1);

    // 60 samples arrive while the worker has answered nothing.
    for (const pt of line(0, 240, 4)) host.appendPoints('s', 1, [pt]);

    const appends = worker.received.filter((c) => c.type === 'appendPoints');
    expect(appends).toHaveLength(1);
    expect(worker.queuedResponses).toBe(1);
    expect(host.getStats().maxQueuedPoints).toBeGreaterThan(1);
  });

  it('loses no stroke content when the worker runs far behind the input', () => {
    const points = line(0, 400, 2);
    const p = preset();

    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    const batches = collect(host);
    host.beginStroke('s', 1, p, 999);

    // Input at full rate; the worker answers only every 20th sample.
    points.forEach((pt, i) => {
      host.appendPoints('s', 1, [pt]);
      if (i % 20 === 0) worker.flush();
    });
    host.endStroke('s', 1);
    while (worker.flush() > 0) {
      /* drain */
    }

    const dabs = batches.flatMap((b) => b.dabs);
    const expected = runWholeStroke(p, points, 999).dabs;
    expect(dabs).toEqual(expected);
  });

  it('cancels the in-flight generation, not a fresh one', () => {
    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    const batches = collect(host);

    host.beginStroke('s', 1, preset(), 1);
    host.appendPoints('s', 1, line(0, 40, 4));
    host.cancelStroke('s', 1);

    const cancel = worker.received.find((c) => c.type === 'cancelStroke');
    expect(cancel).toMatchObject({ strokeId: 's', generation: 1 });

    // Stroke B starts immediately and must be unaffected.
    host.beginStroke('s', 2, preset(), 2);
    host.appendPoints('s', 2, line(100, 140, 4));
    worker.flush();
    host.endStroke('s', 2);
    worker.flush();

    expect(batches.every((b) => b.generation === 2)).toBe(true);
    expect(batches.flatMap((b) => b.dabs).length).toBeGreaterThan(0);
  });

  it('drops a stale response that arrives after cancellation', () => {
    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    const batches = collect(host);

    host.beginStroke('s', 1, preset(), 1);
    host.appendPoints('s', 1, line(0, 40, 4));
    host.cancelStroke('s', 1);
    worker.flush(); // stale batch for generation 1 arrives now

    expect(batches).toHaveLength(0);
    expect(host.getStats().staleResponsesDropped).toBeGreaterThan(0);
    expect(host.activeStrokeCount).toBe(0);
  });

  it('settles endStroke exactly once and leaves no stroke state behind', () => {
    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    collect(host);
    const settled = vi.fn();

    host.beginStroke('s', 1, preset(), 1);
    host.appendPoints('s', 1, line(0, 40, 4));
    host.endStroke('s', 1, settled);
    expect(settled).not.toHaveBeenCalled();
    while (worker.flush() > 0) {
      /* drain */
    }
    expect(settled).toHaveBeenCalledTimes(1);
    expect(host.activeStrokeCount).toBe(0);
  });

  it('settles synchronously when no worker is in use', () => {
    const host = new BrushWorkerHost(null);
    collect(host);
    const settled = vi.fn();
    host.beginStroke('s', 1, preset(), 1);
    host.appendPoints('s', 1, line(0, 40, 4));
    host.endStroke('s', 1, settled);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('finishes the stroke on the main thread when the worker stalls', () => {
    const points = line(0, 200, 4);
    const p = preset();
    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    const batches = collect(host);

    host.beginStroke('s', 1, p, 555);
    host.appendPoints('s', 1, points.slice(0, 10));
    worker.flush(); // first batch answered normally
    host.appendPoints('s', 1, points.slice(10));
    vi.advanceTimersByTime(5_000); // worker never answers the second batch
    host.endStroke('s', 1);

    const dabs = batches.flatMap((b) => b.dabs);
    expect(dabs).toEqual(runWholeStroke(p, points, 555).dabs);
    expect(batches.some((b) => b.source === 'worker')).toBe(true);
    expect(batches.some((b) => b.source === 'sync')).toBe(true);
    expect(host.getStats().workerTimeouts).toBe(1);
  });

  it('does not retire the worker after a single stall', () => {
    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    collect(host);
    host.beginStroke('s', 1, preset(), 1);
    host.appendPoints('s', 1, line(0, 40, 4));
    vi.advanceTimersByTime(5_000);
    host.endStroke('s', 1);
    expect(host.isUsingWorker).toBe(true);
  });

  it('retires the worker after repeated stalls', () => {
    const worker = new FakeWorker();
    worker.manual = true;
    const host = new BrushWorkerHost(worker as unknown as Worker);
    collect(host);
    for (let g = 1; g <= 3; g++) {
      host.beginStroke('s', g, preset(), g);
      host.appendPoints('s', g, line(0, 40, 4));
      vi.advanceTimersByTime(5_000);
      host.endStroke('s', g);
    }
    expect(host.isUsingWorker).toBe(false);
  });

  it('completes the stroke when the worker dies mid-stroke', () => {
    const points = line(0, 160, 4);
    const p = preset();
    const worker = new FakeWorker();
    const host = new BrushWorkerHost(worker as unknown as Worker);
    const batches = collect(host);

    host.beginStroke('s', 1, p, 31);
    host.appendPoints('s', 1, points.slice(0, 8));
    worker.onerror?.(new Error('boom'));
    host.appendPoints('s', 1, points.slice(8));
    host.endStroke('s', 1);

    expect(host.isUsingWorker).toBe(false);
    expect(batches.flatMap((b) => b.dabs)).toEqual(runWholeStroke(p, points, 31).dabs);
  });

  it('never lets two concurrent strokes perturb each other', () => {
    const p = preset();
    const a = line(0, 80, 4);
    const b = line(200, 280, 4);

    const solo = new BrushWorkerHost(null);
    const soloBatches = collect(solo);
    solo.beginStroke('a', 1, p, 11);
    for (const pt of a) solo.appendPoints('a', 1, [pt]);
    solo.endStroke('a', 1);

    const both = new BrushWorkerHost(null);
    const bothBatches = collect(both);
    both.beginStroke('a', 1, p, 11);
    both.beginStroke('b', 1, p, 22);
    for (let i = 0; i < a.length; i++) {
      both.appendPoints('a', 1, [a[i]!]);
      both.appendPoints('b', 1, [b[i]!]);
    }
    both.endStroke('a', 1);
    both.endStroke('b', 1);

    const aDabs = bothBatches.filter((x) => x.strokeId === 'a').flatMap((x) => x.dabs);
    expect(aDabs).toEqual(soloBatches.flatMap((x) => x.dabs));
  });
});
