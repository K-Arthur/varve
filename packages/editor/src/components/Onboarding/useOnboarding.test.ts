// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useOnboarding } from './useOnboarding';

describe('useOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not auto-show the welcome dialog or tour on mount', () => {
    const { result } = renderHook(() => useOnboarding());
    // First launch must be non-blocking: nothing is shown automatically.
    expect(result.current.active).toBe(false);
    expect(result.current.showWelcome).toBe(false);
    expect(result.current.isComplete()).toBe(false);
  });

  it('requestWelcome surfaces the dialog on demand without marking complete', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.requestWelcome();
    });
    expect(result.current.showWelcome).toBe(true);
    expect(result.current.active).toBe(true);
    expect(result.current.isComplete()).toBe(false);
  });

  it('reopen starts the tour without showing the welcome dialog', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.reopen();
    });
    expect(result.current.active).toBe(true);
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.showWelcome).toBe(false);
  });

  it('dismiss marks onboarding complete and hides everything', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.reopen();
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.isComplete()).toBe(true);
  });
});
