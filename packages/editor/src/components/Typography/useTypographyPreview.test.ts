import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTypographyPreview } from './useTypographyPreview';

describe('useTypographyPreview', () => {
  it('keeps navigation outside history and commits the final face once', () => {
    const apply = vi.fn();
    const begin = vi.fn();
    const commit = vi.fn();
    const abort = vi.fn();
    const { result } = renderHook(() =>
      useTypographyPreview(apply, {
        beginPreview: begin,
        commitPreview: commit,
        abortPreview: abort,
      }),
    );

    act(() => result.current.previewChanges({ fontFamily: 'Preview Sans' }));
    act(() => result.current.previewChanges({ fontFamily: 'Preview Serif' }));

    expect(begin).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenNthCalledWith(1, { fontFamily: 'Preview Sans' });
    expect(apply).toHaveBeenNthCalledWith(2, { fontFamily: 'Preview Serif' });
    expect(commit).not.toHaveBeenCalled();

    act(() => result.current.commitChanges({ fontFamily: 'Committed Sans' }));

    expect(apply).toHaveBeenLastCalledWith({ fontFamily: 'Committed Sans' });
    expect(commit).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
  });

  it('restores a preview on dismissal and when the target changes', () => {
    const apply = vi.fn();
    const begin = vi.fn();
    const commit = vi.fn();
    const abort = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ target }) =>
        useTypographyPreview(apply, {
          beginPreview: begin,
          commitPreview: commit,
          abortPreview: abort,
          resetKey: target,
        }),
      { initialProps: { target: 'text-a' } },
    );

    act(() => result.current.previewChanges({ fontFamily: 'Preview Sans' }));
    act(() => rerender({ target: 'text-b' }));
    expect(abort).toHaveBeenCalledOnce();

    act(() => result.current.previewChanges({ fontFamily: 'Preview Serif' }));
    act(() => result.current.clearPreview());
    expect(abort).toHaveBeenCalledTimes(2);

    act(() => result.current.previewChanges({ fontFamily: 'Preview Mono' }));
    unmount();
    expect(abort).toHaveBeenCalledTimes(3);
    expect(commit).not.toHaveBeenCalled();
  });

  it('falls back to an ordinary apply when a surface has no preview boundary', () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useTypographyPreview(apply));

    act(() => result.current.previewChanges({ fontFamily: 'Immediate Sans' }));
    act(() => result.current.commitChanges({ fontFamily: 'Committed Sans' }));

    expect(apply).toHaveBeenNthCalledWith(1, { fontFamily: 'Committed Sans' });
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
