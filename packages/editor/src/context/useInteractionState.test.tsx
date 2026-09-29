import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useInteractionState } from './useInteractionState';

describe('useInteractionState canvas cancellation registry', () => {
  it('cancels only the matching session and unregisters the current owner', () => {
    const { result } = renderHook(() => useInteractionState());
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();
    let unregisterFirst = () => {};
    let unregisterSecond = () => {};

    act(() => {
      unregisterFirst = result.current.registerCanvasInteractionCancellation('first', firstCancel);
      unregisterSecond = result.current.registerCanvasInteractionCancellation(
        'second',
        secondCancel,
      );
    });

    act(() => expect(result.current.cancelCanvasInteraction('first')).toBe(true));
    expect(firstCancel).toHaveBeenCalledOnce();
    expect(secondCancel).not.toHaveBeenCalled();

    act(() => unregisterFirst());
    expect(result.current.cancelCanvasInteraction('first')).toBe(false);
    expect(result.current.cancelCanvasInteraction('second')).toBe(true);
    expect(secondCancel).toHaveBeenCalledOnce();

    act(() => unregisterSecond());
    expect(result.current.cancelCanvasInteraction('second')).toBe(false);
  });

  it('does not let an older canvas cleanup unregister its replacement', () => {
    const { result } = renderHook(() => useInteractionState());
    const oldCancel = vi.fn();
    const newCancel = vi.fn();
    let unregisterOld = () => {};

    act(() => {
      unregisterOld = result.current.registerCanvasInteractionCancellation('same', oldCancel);
      result.current.registerCanvasInteractionCancellation('same', newCancel);
      unregisterOld();
    });

    expect(result.current.cancelCanvasInteraction('same')).toBe(true);
    expect(oldCancel).not.toHaveBeenCalled();
    expect(newCancel).toHaveBeenCalledOnce();
  });
});
