import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTreeFocus } from './useTreeFocus';

describe('useTreeFocus', () => {
  it('initializes focusIdx and anchorIdx to 0', () => {
    const { result } = renderHook(() => useTreeFocus(10));
    expect(result.current.focusIdx).toBe(0);
    expect(result.current.anchorIdx).toBe(0);
  });

  describe('entries length clamping', () => {
    it('clamps focusIdx when entries decrease below current index', () => {
      const { result, rerender } = renderHook(
        ({ len }) => useTreeFocus(len),
        { initialProps: { len: 10 } },
      );

      act(() => result.current.setFocusIdx(8));
      expect(result.current.focusIdx).toBe(8);

      // Rerender with fewer entries — focusIdx should clamp to 4
      rerender({ len: 5 });
      expect(result.current.focusIdx).toBe(4);
    });

    it('clamps focusIdx to 0 when entries become empty', () => {
      const { result, rerender } = renderHook(
        ({ len }) => useTreeFocus(len),
        { initialProps: { len: 5 } },
      );

      act(() => result.current.setFocusIdx(3));
      rerender({ len: 0 });
      expect(result.current.focusIdx).toBe(0);
    });

    it('leaves focusIdx unchanged when entries increase', () => {
      const { result, rerender } = renderHook(
        ({ len }) => useTreeFocus(len),
        { initialProps: { len: 5 } },
      );

      act(() => result.current.setFocusIdx(3));
      rerender({ len: 10 });
      expect(result.current.focusIdx).toBe(3);
    });

    it('clamps anchorIdx when entries decrease below current index', () => {
      const { result, rerender } = renderHook(
        ({ len }) => useTreeFocus(len),
        { initialProps: { len: 10 } },
      );

      act(() => result.current.setAnchorIdx(7));
      rerender({ len: 4 });
      expect(result.current.anchorIdx).toBe(3);
    });

    it('clamps both focusIdx and anchorIdx simultaneously', () => {
      const { result, rerender } = renderHook(
        ({ len }) => useTreeFocus(len),
        { initialProps: { len: 10 } },
      );

      act(() => {
        result.current.setFocusIdx(9);
        result.current.setAnchorIdx(8);
      });
      rerender({ len: 5 });
      expect(result.current.focusIdx).toBe(4);
      expect(result.current.anchorIdx).toBe(4);
    });

    it('does not clamp when entries length stays the same', () => {
      const { result, rerender } = renderHook(
        ({ len }) => useTreeFocus(len),
        { initialProps: { len: 10 } },
      );

      act(() => result.current.setFocusIdx(5));
      rerender({ len: 10 });
      expect(result.current.focusIdx).toBe(5);
    });
  });
});
