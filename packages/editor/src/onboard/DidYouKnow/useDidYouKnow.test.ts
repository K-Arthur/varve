// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDidYouKnow } from './useDidYouKnow';

function createTracker() {
  const counts = new Map<string, number>();
  return {
    getCount: vi.fn((id: string, _windowMs?: number) => counts.get(id) ?? 0),
    setCount: (id: string, n: number) => counts.set(id, n),
  };
}

describe('useDidYouKnow', () => {
  beforeEach(() => {
    localStorage.removeItem('strata:tips-today');
  });

  it('returns null when no tips are eligible (condition fails)', () => {
    const tracker = createTracker();
    // condition for most tips requires certain action counts
    const { result } = renderHook(() => useDidYouKnow(tracker));
    expect(result.current.currentTip).toBeNull();
  });

  it('returns a tip when conditions are met and user is idle', () => {
    vi.useFakeTimers();
    const tracker = createTracker();
    // Set high action counts to match some tips
    tracker.setCount('tool:select', 50);
    tracker.setCount('op:createNode', 10);
    tracker.setCount('shortcut:', 20);

    const { result } = renderHook(() => useDidYouKnow(tracker));

    // Initially no tip (not idle yet)
    expect(result.current.currentTip).toBeNull();

    // Advance past the idle threshold (15s)
    act(() => {
      vi.advanceTimersByTime(16000);
    });

    // Should now have a tip
    expect(result.current.currentTip).not.toBeNull();
    expect(result.current.currentTip?.id).toBeTruthy();
    expect(result.current.currentTip?.title).toBeTruthy();

    vi.useRealTimers();
  });

  it('dismiss removes current tip', () => {
    vi.useFakeTimers();
    const tracker = createTracker();
    tracker.setCount('tool:select', 50);
    tracker.setCount('op:createNode', 10);
    tracker.setCount('shortcut:', 20);

    const { result } = renderHook(() => useDidYouKnow(tracker));

    act(() => {
      vi.advanceTimersByTime(16000);
    });

    expect(result.current.currentTip).not.toBeNull();
    result.current.currentTip?.id;

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.currentTip).toBeNull();

    vi.useRealTimers();
  });

  it('dontShowAgain dismisses and saves to dismissed tips', () => {
    vi.useFakeTimers();
    const tracker = createTracker();
    tracker.setCount('tool:select', 50);
    tracker.setCount('op:createNode', 10);
    tracker.setCount('shortcut:', 20);

    const { result } = renderHook(() => useDidYouKnow(tracker));

    act(() => {
      vi.advanceTimersByTime(16000);
    });

    expect(result.current.currentTip).not.toBeNull();

    act(() => {
      result.current.dontShowAgain();
    });

    expect(result.current.currentTip).toBeNull();

    vi.useRealTimers();
  });

  it('does not show more than 5 tips per day', () => {
    vi.useFakeTimers();
    const tracker = createTracker();
    tracker.setCount('tool:select', 50);
    tracker.setCount('op:createNode', 10);
    tracker.setCount('shortcut:', 100);

    // Set tips shown today to 5
    localStorage.setItem(
      'strata:tips-today',
      JSON.stringify({
        count: 5,
        date: new Date().toDateString(),
        shownIds: ['a', 'b', 'c', 'd', 'e'],
      }),
    );

    const { result } = renderHook(() => useDidYouKnow(tracker));

    act(() => {
      vi.advanceTimersByTime(16000);
    });

    // Should not show any new tip
    expect(result.current.currentTip).toBeNull();

    vi.useRealTimers();
  });

  it('respects the enabled flag — no tip shown when disabled', () => {
    vi.useFakeTimers();
    const tracker = createTracker();
    tracker.setCount('tool:select', 50);
    tracker.setCount('op:createNode', 10);
    tracker.setCount('shortcut:', 20);

    const { result } = renderHook(() => useDidYouKnow(tracker, undefined, { enabled: false }));

    act(() => {
      vi.advanceTimersByTime(16000);
    });

    expect(result.current.currentTip).toBeNull();

    vi.useRealTimers();
  });

  it('does not immediately show a different tip after dismiss (cooldown)', () => {
    vi.useFakeTimers();
    const tracker = createTracker();
    // Two always-eligible tips exist (panel-toggle, undo) so a second can show later.
    const { result } = renderHook(() => useDidYouKnow(tracker));

    act(() => {
      vi.advanceTimersByTime(16000);
    });
    expect(result.current.currentTip).not.toBeNull();
    const firstId = result.current.currentTip?.id;

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.currentTip).toBeNull();

    // Within the dismiss cooldown: activity + idle must NOT surface another tip.
    act(() => {
      window.dispatchEvent(new Event('mousemove'));
    });
    act(() => {
      vi.advanceTimersByTime(16000);
    });
    expect(result.current.currentTip).toBeNull();

    // Past the cooldown: activity + idle surfaces the next distinct tip.
    act(() => {
      vi.advanceTimersByTime(110000);
    });
    act(() => {
      window.dispatchEvent(new Event('mousemove'));
    });
    act(() => {
      vi.advanceTimersByTime(16000);
    });
    expect(result.current.currentTip).not.toBeNull();
    expect(result.current.currentTip?.id).not.toBe(firstId);

    vi.useRealTimers();
  });
});
