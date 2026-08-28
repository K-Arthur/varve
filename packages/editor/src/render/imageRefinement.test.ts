import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleSettledImageRefinement } from './imageRefinement';

describe('scheduleSettledImageRefinement', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces camera frames into one settled refinement', () => {
    vi.useFakeTimers();
    const request = vi.fn();
    const canvas = document.createElement('canvas');

    scheduleSettledImageRefinement(canvas, () => false, request);
    scheduleSettledImageRefinement(canvas, () => false, request);
    vi.advanceTimersByTime(180);

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('waits until an interaction has actually ended', () => {
    vi.useFakeTimers();
    let interacting = true;
    const request = vi.fn();
    const canvas = document.createElement('canvas');

    scheduleSettledImageRefinement(canvas, () => interacting, request);
    vi.advanceTimersByTime(180);
    expect(request).not.toHaveBeenCalled();

    interacting = false;
    vi.advanceTimersByTime(180);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
