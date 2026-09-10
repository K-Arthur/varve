import { describe, expect, it } from 'vitest';
import { type CalibratedTimestamp, eventQueueDelayMs, isConfidentlyOrdered } from '../clockDomain';

describe('eventQueueDelayMs', () => {
  it('returns the delay when the event shares the performance.now domain', () => {
    expect(eventQueueDelayMs(1_000, 1_004.5)).toBeCloseTo(4.5, 5);
  });

  it('rejects a zero or synthesized timestamp', () => {
    expect(eventQueueDelayMs(0, 1_000)).toBeNull();
    expect(eventQueueDelayMs(Number.NaN, 1_000)).toBeNull();
  });

  it('rejects a timestamp from the future (clock skew or synthetic event)', () => {
    expect(eventQueueDelayMs(1_010, 1_000)).toBeNull();
  });

  it('rejects an epoch-domain timestamp rather than reporting it as latency', () => {
    // A legacy epoch timeStamp against a small performance.now() would report
    // ~1.7e12 ms of "input delay" if subtracted naively.
    expect(eventQueueDelayMs(Date.now(), 1_234)).toBeNull();
  });
});

describe('isConfidentlyOrdered', () => {
  const at = (valueMs: number, uncertaintyMs: number): CalibratedTimestamp => ({
    valueMs,
    uncertaintyMs,
    source: 'worker.calibrated',
    calibrationGeneration: 1,
  });

  it('accepts an ordering wider than the combined uncertainty', () => {
    expect(isConfidentlyOrdered(at(10, 0.5), at(20, 0.5))).toBe(true);
  });

  it('refuses an ordering inside the combined uncertainty', () => {
    expect(isConfidentlyOrdered(at(10, 3), at(12, 3))).toBe(false);
  });

  it('refuses a reversed ordering', () => {
    expect(isConfidentlyOrdered(at(20, 0.1), at(10, 0.1))).toBe(false);
  });
});
