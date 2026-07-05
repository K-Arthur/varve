import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypeAhead } from './useTypeAhead';

describe('useTypeAhead', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getName = (i: number) => ['Apple', 'Banana', 'Avocado', 'Cherry'][i] ?? '';

  it('accumulates characters in the buffer across rapid calls', () => {
    const { result } = renderHook(() => useTypeAhead());

    const idx1 = result.current.handleTypeAhead('A', getName, 0, 4);
    expect(idx1).toBe(2); // wraps: Apple skipped (currentIdx), Banana (1) fails, Avocado (2) matches

    const idx2 = result.current.handleTypeAhead('p', getName, 0, 4);
    expect(idx2).toBe(0); // "ap" matches Apple
  });

  it('resets the buffer after 500ms of inactivity', () => {
    const { result } = renderHook(() => useTypeAhead());

    result.current.handleTypeAhead('A', getName, 0, 4);
    vi.advanceTimersByTime(500);

    // After reset, typing 'A' again should match Avocado (first non-Apple after currentIdx)
    const idx = result.current.handleTypeAhead('A', getName, 0, 4);
    expect(idx).toBe(2);
  });

  it('clears the timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useTypeAhead());

    result.current.handleTypeAhead('A', getName, 0, 4);
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    clearTimeoutSpy.mockRestore();
  });
});
