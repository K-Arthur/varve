/**
 * useSelectionHistory tests — selection history stack navigation.
 */

import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSelectionHistory } from './useSelectionHistory';

describe('useSelectionHistory', () => {
  it('pushes new selection entries', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
    });
    expect(result.current.canGoBack()).toBe(true);
    expect(result.current.canGoForward()).toBe(false);
  });

  it('dedupes consecutive identical selections', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
      result.current.push(['node1']);
    });
    expect(result.current.canGoBack()).toBe(true);
    expect(result.current.canGoForward()).toBe(false);
  });

  it('selectPrevious returns previous selection', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
      result.current.push(['node2']);
    });
    let prev: string[] | null;
    act(() => {
      prev = result.current.selectPrevious();
    });
    expect(prev).toEqual(['node1']);
    expect(result.current.canGoBack()).toBe(false);
    expect(result.current.canGoForward()).toBe(true);
  });

  it('selectNext returns next selection', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
      result.current.push(['node2']);
      result.current.selectPrevious();
    });
    let next: string[] | null;
    act(() => {
      next = result.current.selectNext();
    });
    expect(next).toEqual(['node2']);
    expect(result.current.canGoBack()).toBe(true);
    expect(result.current.canGoForward()).toBe(false);
  });

  it('truncates forward history when pushing new entry', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
      result.current.push(['node2']);
      result.current.push(['node3']);
      result.current.selectPrevious();
      result.current.selectPrevious();
    });
    act(() => {
      result.current.push(['node4']);
    });
    expect(result.current.canGoBack()).toBe(true);
    expect(result.current.canGoForward()).toBe(false);
  });

  it('caps history at MAX_HISTORY', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      for (let i = 0; i < 60; i++) {
        result.current.push([`node${i}`]);
      }
    });
    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.canGoBack()).toBe(true);
  });

  it('reset clears history', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
      result.current.push(['node2']);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.canGoBack()).toBe(false);
    expect(result.current.canGoForward()).toBe(false);
  });

  it('selectPrevious returns null at start', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
    });
    let prev: string[] | null;
    act(() => {
      prev = result.current.selectPrevious();
    });
    expect(prev).toBeNull();
  });

  it('selectNext returns null at end', () => {
    const { result } = renderHook(() => useSelectionHistory());
    act(() => {
      result.current.push(['node1']);
    });
    let next: string[] | null;
    act(() => {
      next = result.current.selectNext();
    });
    expect(next).toBeNull();
  });
});
