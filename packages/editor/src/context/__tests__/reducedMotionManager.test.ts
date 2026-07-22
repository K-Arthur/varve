import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetReducedMotion,
  isReducedMotion,
  setReducedMotionOverride,
  subscribeReducedMotion,
  useReducedMotion,
} from '../reducedMotionManager';

interface MockMatchMediaResult {
  triggerChange: (matches: boolean) => void;
}

function mockMatchMedia(matches: boolean): MockMatchMediaResult {
  const listeners = new Map<string, (ev: MediaQueryListEvent) => void>();
  const mq = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, fn: (ev: MediaQueryListEvent) => void) => {
      listeners.set('change', fn);
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    if (query === '(prefers-reduced-motion: reduce)') return mq as unknown as MediaQueryList;
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
  return {
    triggerChange: (newMatches: boolean) => {
      const handler = listeners.get('change');
      if (handler) handler({ matches: newMatches } as MediaQueryListEvent);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetReducedMotion();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isReducedMotion', () => {
  it('returns false by default when not preferred', () => {
    mockMatchMedia(false);
    expect(isReducedMotion()).toBe(false);
  });

  it('returns false in non-browser environment', () => {
    const win: Window | undefined = typeof window !== 'undefined' ? window : undefined;
    vi.stubGlobal('window', undefined);
    expect(isReducedMotion()).toBe(false);
    if (win) vi.stubGlobal('window', win);
  });

  it('returns true when prefers-reduced-motion: reduce is set', () => {
    mockMatchMedia(true);
    expect(isReducedMotion()).toBe(true);
  });

  it('applies the persisted application override before the settings dialog opens', () => {
    localStorage.setItem(
      'strata-editor-settings',
      JSON.stringify({ performance: { reducedMotionOverride: 'always' } }),
    );
    mockMatchMedia(false);
    expect(isReducedMotion()).toBe(true);
  });
});

describe('setReducedMotionOverride', () => {
  it('overrides the media query value when set to true', () => {
    mockMatchMedia(false);
    setReducedMotionOverride(true);
    expect(isReducedMotion()).toBe(true);
  });

  it('overrides the media query value when set to false', () => {
    mockMatchMedia(true);
    setReducedMotionOverride(false);
    expect(isReducedMotion()).toBe(false);
  });

  it('returns to media query value when cleared', () => {
    mockMatchMedia(true);
    setReducedMotionOverride(false);
    expect(isReducedMotion()).toBe(false);
    setReducedMotionOverride(null);
    expect(isReducedMotion()).toBe(true);
  });
});

describe('subscribeReducedMotion', () => {
  it('notifies subscribers on change', () => {
    const { triggerChange } = mockMatchMedia(false);
    const fn = vi.fn();
    subscribeReducedMotion(fn);
    triggerChange(true);
    expect(fn).toHaveBeenCalledWith(true);
  });

  it('returned unsubscribe function stops notifications', () => {
    const { triggerChange } = mockMatchMedia(false);
    const fn = vi.fn();
    const unsub = subscribeReducedMotion(fn);
    unsub();
    triggerChange(true);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('useReducedMotion', () => {
  it('returns false when not preferred', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when reduce is preferred', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });
});
