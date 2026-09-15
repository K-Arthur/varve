import { describe, expect, it, vi } from 'vitest';
import { debounce, throttle } from './debounce';

describe('debounce', () => {
  it('invokes callback after delay', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced('a');
    expect(fn).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('cancels previous invocation on new call', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced('a');
    debounced('b');
    await new Promise((r) => setTimeout(r, 60));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });
});

describe('throttle', () => {
  it('invokes immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not invoke again within interval', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('invokes after interval passes', async () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 50);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 60));
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
