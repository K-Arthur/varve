import { describe, expect, it, vi } from 'vitest';
import { LatestPointerQueue } from './latestPointerQueue';

describe('LatestPointerQueue', () => {
  it('consumes only the newest sample scheduled before a frame', () => {
    let frameCallback: (() => void) | undefined;
    const consume = vi.fn();
    const queue = new LatestPointerQueue(
      (callback) => {
        frameCallback = callback;
        return 7;
      },
      vi.fn(),
      consume,
    );

    queue.push('first');
    queue.push('latest');
    frameCallback?.();

    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith('latest');
  });

  it('drops pending input when the gesture is cancelled', () => {
    let frameCallback: (() => void) | undefined;
    const cancel = vi.fn();
    const consume = vi.fn();
    const queue = new LatestPointerQueue(
      (callback) => {
        frameCallback = callback;
        return 11;
      },
      cancel,
      consume,
    );

    queue.push('stale');
    queue.cancelPending();
    frameCallback?.();

    expect(cancel).toHaveBeenCalledWith(11);
    expect(consume).not.toHaveBeenCalled();
  });
});
