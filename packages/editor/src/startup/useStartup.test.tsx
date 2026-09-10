import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_MILESTONES } from './startupTimer';
import { useStartup } from './useStartup';

const mockLoadSettings = vi.fn();

vi.mock('../settings', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
}));

const defaultSettings = {
  export: {},
  appearance: { reduceMotion: false, theme: 'light' },
  panel: {},
  render: {},
  startup: { showBrandedLoader: true },
};

describe('useStartup', () => {
  beforeEach(() => {
    mockLoadSettings.mockReturnValue(defaultSettings);
    sessionStorage.clear();
  });

  it('shows loader when branded mode is enabled and boot not ready', () => {
    const { result } = renderHook(() => useStartup({}));
    expect(result.current.showLoader).toBe(true);
    expect(result.current.bootState).toBe('init');
  });

  it('hides loader when branded mode is disabled', () => {
    mockLoadSettings.mockReturnValue({
      ...defaultSettings,
      startup: { showBrandedLoader: false },
    });
    const { result } = renderHook(() => useStartup({}));
    expect(result.current.showLoader).toBe(false);
    expect(result.current.bootState).toBe('init');
  });

  it('hides loader when boot reaches home_ready', () => {
    const { result } = renderHook(() => useStartup({}));
    act(() => {
      result.current.onHomeReady();
    });
    expect(result.current.showLoader).toBe(false);
    expect(result.current.bootState).toBe('home_ready');
  });

  it('calls onBootComplete callback when editor_ready', () => {
    const onBootComplete = vi.fn();
    const { result } = renderHook(() => useStartup({ onBootComplete }));
    act(() => {
      result.current.onHomeReady();
    });
    act(() => {
      result.current.onEditorReady();
    });
    expect(onBootComplete).toHaveBeenCalledOnce();
  });

  it('provides error state', () => {
    const { result } = renderHook(() => useStartup({}));
    act(() => {
      result.current.onBootError(new Error('Init failed'));
    });
    expect(result.current.bootError).toBe('Init failed');
    expect(result.current.showLoader).toBe(true);
  });

  it('retry resets boot manager so home can become ready again', () => {
    const { result } = renderHook(() => useStartup({}));
    act(() => {
      result.current.onBootError(new Error('Init failed'));
    });
    act(() => {
      result.current.onRetry();
    });
    act(() => {
      result.current.onHomeReady();
    });
    expect(result.current.bootError).toBeNull();
    expect(result.current.bootState).toBe('home_ready');
    expect(result.current.showLoader).toBe(false);
  });

  it('increments retryCount on retry', () => {
    const { result } = renderHook(() => useStartup({}));
    expect(result.current.retryCount).toBe(0);
    act(() => {
      result.current.onRetry();
    });
    expect(result.current.retryCount).toBe(1);
  });

  it('skips branded loader on warm restart (sessionStorage)', () => {
    sessionStorage.setItem('varve-session-started', '1');
    const { result } = renderHook(() => useStartup({}));
    expect(result.current.showLoader).toBe(false);
    expect(result.current.bootState).toBe('init');
  });

  it('returns startup capabilities', () => {
    const { result } = renderHook(() => useStartup({}));
    expect(result.current.capabilities).toBeDefined();
    expect(typeof result.current.capabilities.canAnimate).toBe('boolean');
  });

  it('returns startupTime as a number', () => {
    const { result } = renderHook(() => useStartup({}));
    expect(typeof result.current.startupTime).toBe('number');
  });

  it('keeps state initialization distinct from visible readiness milestones', () => {
    const { result } = renderHook(() => useStartup({}));
    act(() => {
      result.current.markHomeDataReady();
      result.current.onHomeReady();
      result.current.markEditorStateInitialized();
    });

    expect(result.current.bootState).toBe('home_ready');
    expect(result.current.exportStartupTimeline().marks.map((mark) => mark.name)).toEqual([
      STARTUP_MILESTONES.APP_MOUNT,
      STARTUP_MILESTONES.HOME_DATA_READY,
      STARTUP_MILESTONES.HOME_INTERACTIVE,
      STARTUP_MILESTONES.EDITOR_STATE_INITIALIZED,
    ]);

    act(() => result.current.onEditorReady());
    expect(result.current.bootState).toBe('editor_ready');
    expect(result.current.exportStartupTimeline().marks.at(-1)?.name).toBe(
      STARTUP_MILESTONES.EDITOR_FIRST_VISIBLE_CANVAS,
    );
  });
});
