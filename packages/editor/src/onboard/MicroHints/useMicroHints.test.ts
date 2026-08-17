/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissMicroHint, loadOnboardingState, saveOnboardingState } from '../onboardingStore';
import { useMicroHints } from './useMicroHints';

describe('useMicroHints', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('does not show hint for select (skipped tool)', () => {
    const { result } = renderHook(() =>
      useMicroHints({ toolId: 'select', enabled: true, selectionCount: 1 }),
    );
    expect(result.current.currentHint).toBeNull();
  });

  it('shows hint for rect tool on first use', () => {
    const { result, rerender } = renderHook(
      ({ toolId }) => useMicroHints({ toolId, enabled: true, selectionCount: 1 }),
      { initialProps: { toolId: 'select' } },
    );
    rerender({ toolId: 'rect' });
    expect(result.current.currentHint).not.toBeNull();
    expect(result.current.currentHint?.id).toBe('rect.first-use');
  });

  it('does not show hint for rect tool if already dismissed', () => {
    const state = loadOnboardingState();
    saveOnboardingState(dismissMicroHint(state, 'rect.first-use'));

    const { result, rerender } = renderHook(
      ({ toolId }) => useMicroHints({ toolId, enabled: true, selectionCount: 1 }),
      { initialProps: { toolId: 'select' } },
    );
    rerender({ toolId: 'rect' });
    expect(result.current.currentHint).toBeNull();
  });

  it('dismiss callback persists state', () => {
    const { result, rerender } = renderHook(
      ({ toolId }) => useMicroHints({ toolId, enabled: true, selectionCount: 1 }),
      { initialProps: { toolId: 'select' } },
    );
    rerender({ toolId: 'rect' });
    expect(result.current.currentHint).not.toBeNull();

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.currentHint).toBeNull();
    const state = loadOnboardingState();
    expect(state.dismissedMicroHints).toContain('rect.first-use');
  });

  it('does not show hints when disabled', () => {
    const { result, rerender } = renderHook(
      ({ toolId, enabled }) => useMicroHints({ toolId, enabled, selectionCount: 1 }),
      { initialProps: { toolId: 'select', enabled: true } },
    );
    rerender({ toolId: 'rect', enabled: false });
    expect(result.current.currentHint).toBeNull();
  });

  it('auto-dismisses hint after duration', () => {
    const { result, rerender } = renderHook(
      ({ toolId }) => useMicroHints({ toolId, enabled: true, selectionCount: 1 }),
      { initialProps: { toolId: 'select' } },
    );
    rerender({ toolId: 'rect' });
    expect(result.current.currentHint).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.currentHint).toBeNull();
  });

  it('shows multi-select hint when selection count reaches 2', () => {
    const { result, rerender } = renderHook(
      ({ selectionCount }) => useMicroHints({ toolId: 'select', enabled: true, selectionCount }),
      { initialProps: { selectionCount: 1 } },
    );
    expect(result.current.currentHint).toBeNull();
    rerender({ selectionCount: 2 });
    expect(result.current.currentHint?.id).toBe('select.multi');
  });

  it('does not re-show multi-select hint after dismissal', () => {
    const state = loadOnboardingState();
    saveOnboardingState(dismissMicroHint(state, 'select.multi'));

    const { result, rerender } = renderHook(
      ({ selectionCount }) => useMicroHints({ toolId: 'select', enabled: true, selectionCount }),
      { initialProps: { selectionCount: 1 } },
    );
    rerender({ selectionCount: 2 });
    expect(result.current.currentHint).toBeNull();
  });
});
